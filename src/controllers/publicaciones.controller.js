const { sql, queryP } = require("../dataBase/dbConnection");
const { ok, created, bad, notFound, fail } = require("../utils/http");
const { Q } = require("../queries/publicaciones.queries");
const { Q: AgendaQ } = require("../queries/agenda.queries");
const { enviarNotificacionPush } = require("../utils/firebase");
const { saveOptimizedImage } = require("../utils/imageStorage");
const { insertarNotificacion } = require("../utils/notificaciones");

exports.create = async (req, res) => {
  try {
    const { id_familia, categoria_post, mensaje, tipo } = req.body;
    let url_imagen = null;

    const id_usuario = req.user.id_usuario ?? req.user.id ?? req.user.userId;

    if (req.files && req.files.imagen) {
      try {
        url_imagen = await saveOptimizedImage(req.files.imagen, {
          prefix: 'post',
          maxW: 1280,
          maxH: 1280,
          quality: 75,
          folder: 'edi301/posts',
        });
      } catch (imgErr) {
        return bad(res, imgErr.message || 'Error procesando imagen');
      }
    }

    if (!id_usuario || !categoria_post) {
      return bad(res, 'Faltan datos requeridos');
    }

    const userRows = await queryP(Q.getUserRole, {
      id_usuario: { type: sql.Int, value: id_usuario }
    });

    if (!userRows.length) return bad(res, 'Usuario no encontrado');

    const usuario = userRows[0];
    const rol = (usuario.nombre_rol || '').toString();
    const rolesAutoridad = ['Admin', 'PapaEDI', 'MamaEDI', 'Padre', 'Madre', 'Tutor'];
    const esAutoridad = rolesAutoridad.some(r => rol.includes(r));
    const estadoInicial = esAutoridad ? 'Publicado' : 'Pendiente';
    const tipoFinal = tipo || 'POST';

    const rows = await queryP(Q.create, {
      id_familia:     { type: sql.Int, value: id_familia ? Number(id_familia) : null },
      id_usuario:     { type: sql.Int, value: id_usuario },
      categoria_post: { type: sql.NVarChar, value: categoria_post },
      mensaje:        { type: sql.NVarChar, value: mensaje ?? null },
      url_imagen:     { type: sql.NVarChar, value: url_imagen },
      estado:         { type: sql.NVarChar, value: estadoInicial },
      tipo:           { type: sql.NVarChar, value: tipoFinal },
    });

    const post = rows[0];
    if (!post) return fail(res, new Error('No se pudo crear la publicación'));

    if (estadoInicial === 'Pendiente' && id_familia) {
      console.log(`🔒 Publicación pendiente creada por ${usuario.nombre}. Notificando padres...`);

      // Obtener todos los padres/tutores (con y sin token FCM)
      const padres = await queryP(Q.getParentsByFamilia, {
        id_familia: { type: sql.Int, value: id_familia }
      });

      const titSolicitud = 'Solicitud de Publicación 📝';
      const cuerpoSolicitud = `${usuario.nombre} quiere subir un ${tipoFinal === 'STORY' ? 'historia' : 'post'}. Toca para revisar.`;

      for (const padre of padres) {
        // Push solo si tiene token
        if (padre.fcm_token) {
          try {
            await enviarNotificacionPush(
              padre.fcm_token,
              titSolicitud,
              cuerpoSolicitud,
              { tipo: 'SOLICITUD', id_referencia: post.id_post.toString() }
            );
          } catch (pushErr) {
            console.error('Error enviando push de solicitud:', pushErr);
          }
        }
        // Siempre insertar en historial de notificaciones
        await insertarNotificacion(
          padre.id_usuario,
          titSolicitud,
          cuerpoSolicitud,
          'SOLICITUD',
          post.id_post
        );
      }
    } else {
      console.log(`Publicación creada directamente por ${rol} (${usuario.nombre})`);
    }

    if (estadoInicial === 'Publicado') {
      const autorNombre = `${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`.trim();
      const titNueva = 'Nueva publicación';
      const cuerpoNueva = `${autorNombre} publicó algo nuevo.`;

      if (post.id_familia) {
        // FCM a los que tienen token
        const destinatarios = await queryP(Q.getFamilyTokensForPostNotification, {
          id_familia:         { type: sql.Int, value: post.id_familia },
          id_usuario_excluir: { type: sql.Int, value: id_usuario },
        });
        for (const d of destinatarios) {
          if (!d.fcm_token) continue;
          try {
            await enviarNotificacionPush(d.fcm_token, titNueva, cuerpoNueva, {
              tipo: 'NUEVA_PUBLICACION',
              id_referencia: post.id_post.toString(),
            });
          } catch (pushErr) {
            console.error('Error enviando push de nueva publicación:', pushErr);
          }
        }
        // Historial de notificaciones para TODOS los miembros de la familia
        const todosFamilia = await queryP(Q.getAllFamilyMembers, {
          id_familia:          { type: sql.Int, value: post.id_familia },
          id_usuario_excluir:  { type: sql.Int, value: id_usuario },
        });
        for (const m of todosFamilia) {
          await insertarNotificacion(m.id_usuario, titNueva, cuerpoNueva, 'NUEVA_PUBLICACION', post.id_post);
        }
      } else {
        // Post institucional: solo FCM (notificar a todos sería demasiados registros)
        const destinatarios = await queryP(Q.getGlobalTokensForPostNotification, {
          id_usuario_excluir: { type: sql.Int, value: id_usuario },
        });
        for (const d of destinatarios) {
          if (!d.fcm_token) continue;
          try {
            await enviarNotificacionPush(d.fcm_token, titNueva, cuerpoNueva, {
              tipo: 'NUEVA_PUBLICACION',
              id_referencia: post.id_post.toString(),
            });
          } catch (pushErr) {
            console.error('Error enviando push de nueva publicación:', pushErr);
          }
        }
      }
    }

    const io = req.io;
    if (io && post) {
      if (post.id_familia) {
        io.to(`familia_${post.id_familia}`).emit('post_creado', post);
        if (post.estado === 'Pendiente') {
          io.to(`familia_${post.id_familia}`).emit('post_pendiente_creado', post);
        }
      } else {
        io.to('institucional').emit('post_creado', post);
      }
      io.emit('feed_actualizado', { source: 'publicaciones', id_post: post.id_post });
    }

    created(res, post);
  } catch (e) {
    console.error(e);
    fail(res, e);
  }
};

exports.listByFamilia = async (req, res) => {
  try {
    const idUsuarioActual = req.user.id_usuario ?? req.user.id;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;

    const rows = await queryP(Q.listByFamilia, {
      id_familia: { type: sql.Int, value: Number(req.params.id_familia) },
      current_user_id: { type: sql.Int, value: idUsuarioActual },
      offset: { type: sql.Int, value: offset },
      limit: { type: sql.Int, value: limit },
    });

    ok(res, {
      page,
      limit,
      count: rows.length,
      hasMore: rows.length === limit,
      data: rows,
    });
  } catch (e) {
    fail(res, e);
  }
};

exports.listInstitucional = async (_req, res) => {
  try {
    ok(res, await queryP(Q.listInstitucional));
  } catch (e) {
    fail(res, e);
  }
};

exports.setEstado = async (req, res) => {
  try {
    const { estado } = req.body;
    const idPost = Number(req.params.id);

    if (!["Pendiente", "Aprobada", "Rechazada", "Publicado"].includes(estado)) {
      return bad(res, "estado inválido");
    }

    const postInfo = await queryP(
      `
      SELECT p.id_usuario, p.id_familia, u.fcm_token, u.nombre
      FROM EDI.Publicaciones p
      JOIN EDI.Usuarios u ON u.id_usuario = p.id_usuario
      WHERE p.id_post = @id_post
    `,
      { id_post: { type: sql.Int, value: idPost } },
    );

    if (!postInfo.length) return notFound(res, "Publicación no encontrada");
    const { fcm_token, nombre } = postInfo[0];
    const rows = await queryP(Q.setEstado, {
      estado: { type: sql.NVarChar, value: estado },
      id_post: { type: sql.Int, value: idPost },
    });

    {
      let titulo = "";
      let cuerpo = "";

      if (estado === "Publicado" || estado === "Aprobada") {
        titulo = "¡Publicación Aprobada! 🎉";
        cuerpo = "Tu publicación ya está visible para la familia.";
      } else if (estado === "Rechazada") {
        titulo = "Publicación Rechazada 👮‍♂️";
        cuerpo = "Tu padre/tutor ha rechazado tu solicitud.";
      }

      if (titulo) {
        const autorId = postInfo[0].id_usuario;
        console.log(`🔔 Notificando a ${nombre} sobre su post...`);

        // Push al autor
        if (fcm_token) {
          await enviarNotificacionPush(fcm_token, titulo, cuerpo, {
            tipo: "ESTADO_POST",
            id_referencia: idPost.toString(),
          });
        }
        // Historial para el autor
        const tipoNotif = (estado === "Rechazada") ? "POST_RECHAZADO" : "POST_APROBADO";
        await insertarNotificacion(autorId, titulo, cuerpo, tipoNotif, idPost);

        // Si fue aprobado y es de una familia, notificar a los demás miembros
        if ((estado === "Publicado" || estado === "Aprobada") && postInfo[0].id_familia) {
          const idFamilia = postInfo[0].id_familia;
          const autorNombre = `${nombre ?? ''}`.trim();
          const titNueva = 'Nueva publicación';
          const cuerpoNueva = `${autorNombre} publicó algo nuevo.`;

          // FCM a miembros con token
          const miembrosConToken = await queryP(Q.getFamilyTokensForPostNotification, {
            id_familia:         { type: sql.Int, value: idFamilia },
            id_usuario_excluir: { type: sql.Int, value: autorId },
          });
          for (const m of miembrosConToken) {
            if (!m.fcm_token) continue;
            try {
              await enviarNotificacionPush(m.fcm_token, titNueva, cuerpoNueva, {
                tipo: 'NUEVA_PUBLICACION',
                id_referencia: idPost.toString(),
              });
            } catch (_) {}
          }

          // Historial para todos los miembros de la familia
          const todosMiembros = await queryP(Q.getAllFamilyMembers, {
            id_familia:         { type: sql.Int, value: idFamilia },
            id_usuario_excluir: { type: sql.Int, value: autorId },
          });
          for (const m of todosMiembros) {
            await insertarNotificacion(m.id_usuario, titNueva, cuerpoNueva, 'NUEVA_PUBLICACION', idPost);
          }
        }
      }
    }

    const io = req.io;
    const updated = rows[0];
    if (io && updated) {
      const room = updated.id_familia
        ? `familia_${updated.id_familia}`
        : "institucional";
      io.to(room).emit("post_estado_actualizado", updated);
      if (updated.id_usuario)
        io.to(`user_${updated.id_usuario}`).emit(
          "mi_post_estado_actualizado",
          updated,
        );
      io.emit("feed_actualizado", {
        source: "publicaciones",
        id_post: updated.id_post,
      });
    }

    ok(res, rows[0]);
  } catch (e) {
    fail(res, e);
  }
};

exports.remove = async (req, res) => {
  try {
    const idPost = Number(req.params.id);
    await queryP(Q.softDelete, { id_post: { type: sql.Int, value: idPost } });

    const io = req.io;
    if (io) {
      io.emit("post_eliminado", { id_post: idPost });
      io.emit("feed_actualizado", { source: "publicaciones", id_post: idPost });
    }

    ok(res, { message: "Publicación eliminada" });
  } catch (e) {
    fail(res, e);
  }
};

exports.listPendientes = async (req, res) => {
  try {
    const rows = await queryP(Q.listPendientesPorFamilia, {
      id_familia: { type: sql.Int, value: Number(req.params.id_familia) },
    });
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

// GET /api/publicaciones/mis-pendientes
// Devuelve los posts pendientes de las familias donde el usuario autenticado
// es padre/tutor — sin necesitar que el cliente conozca el id_familia.
exports.misPendientes = async (req, res) => {
  try {
    const id_usuario = req.user.id_usuario ?? req.user.id ?? req.user.userId;
    const rows = await queryP(Q.getMisPendientes, {
      id_usuario: { type: sql.Int, value: id_usuario },
    });
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

exports.listByUsuario = async (req, res) => {
  try {
    console.log("🔍 Intentando listar mis posts. Token descifrado:", req.user);

    const id_usuario = req.user.id_usuario ?? req.user.id ?? req.user.userId;
    console.log(`🆔 ID extraído: ${id_usuario}`);

    if (id_usuario === undefined || id_usuario === null) {
      return bad(res, "ID de usuario no encontrado en token");
    }

    const rows = await queryP(Q.listByUsuario, {
      id_usuario: { type: sql.Int, value: id_usuario },
    });

    const resultados = rows || [];

    console.log(`📊 Encontrados: ${resultados.length} posts`);
    ok(res, resultados);
  } catch (e) {
    console.error("💥 Error en listByUsuario:", e);
    fail(res, e);
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const id_post = Number(req.params.id);
    const id_usuario = req.user.id_usuario ?? req.user.id;

    const result = await queryP(Q.toggleLike, {
      id_post: { type: sql.Int, value: id_post },
      id_usuario: { type: sql.Int, value: id_usuario },
    });

    const liked = result[0]?.liked == 1;

    if (liked) {
      const ownerRows = await queryP(Q.getPostOwner, {
        id_post: { type: sql.Int, value: id_post },
      });

      const actorRows = await queryP(Q.getUserBasicInfo, {
        id_usuario: { type: sql.Int, value: id_usuario },
      });

      const owner = ownerRows[0];
      const actor = actorRows[0];

      if (owner && actor && owner.id_usuario !== id_usuario) {
        const actorNombre =
          `${actor.nombre ?? ""} ${actor.apellido ?? ""}`.trim();

        if (owner.fcm_token) {
          try {
            await enviarNotificacionPush(
              owner.fcm_token,
              "Nuevo me gusta",
              `${actorNombre} reaccionó a tu publicación.`,
              { tipo: "NUEVO_LIKE", id_referencia: id_post.toString() }
            );
          } catch (pushErr) {
            console.error("Error enviando push de like:", pushErr);
          }
        }

        // Registrar en historial de notificaciones
        await insertarNotificacion(
          owner.id_usuario,
          "Nuevo me gusta",
          `${actorNombre} reaccionó a tu publicación.`,
          "LIKE",
          id_post
        );
      }
    }

    req.io?.emit("feed_actualizado", { source: "publicaciones", id_post });
    ok(res, result[0]);
  } catch (e) {
    fail(res, e);
  }
};

exports.addComentario = async (req, res) => {
  try {
    const id_post = Number(req.params.id);
    const id_usuario = req.user.id_usuario ?? req.user.id;
    const { contenido } = req.body;

    if (!contenido) return bad(res, "Contenido requerido");

    await queryP(Q.addComentario, {
      id_post: { type: sql.Int, value: id_post },
      id_usuario: { type: sql.Int, value: id_usuario },
      contenido: { type: sql.NVarChar, value: contenido },
    });

    const ownerRows = await queryP(Q.getPostOwner, {
      id_post: { type: sql.Int, value: id_post },
    });

    const actorRows = await queryP(Q.getUserBasicInfo, {
      id_usuario: { type: sql.Int, value: id_usuario },
    });

    const owner = ownerRows[0];
    const actor = actorRows[0];

    if (owner && actor && owner.id_usuario !== id_usuario) {
      const actorNombre =
        `${actor.nombre ?? ""} ${actor.apellido ?? ""}`.trim();

      if (owner.fcm_token) {
        try {
          await enviarNotificacionPush(
            owner.fcm_token,
            "Nuevo comentario",
            `${actorNombre} comentó tu publicación.`,
            { tipo: "NUEVO_COMENTARIO", id_referencia: id_post.toString() }
          );
        } catch (pushErr) {
          console.error("Error enviando push de comentario:", pushErr);
        }
      }

      // Registrar en historial de notificaciones
      await insertarNotificacion(
        owner.id_usuario,
        "Nuevo comentario",
        `${actorNombre} comentó tu publicación.`,
        "COMENTARIO",
        id_post
      );
    }

    req.io?.emit("feed_actualizado", { source: "publicaciones", id_post });

    created(res, { message: "Comentario agregado" });
  } catch (e) {
    fail(res, e);
  }
};

exports.getComentarios = async (req, res) => {
  try {
    const id_post = Number(req.params.id);
    const rows = await queryP(Q.getComentarios, {
      id_post: { type: sql.Int, value: id_post },
    });
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

exports.deleteComentario = async (req, res) => {
  try {
    const idComentario = Number(req.params.id);
    const idUsuarioSolicitante = req.user.id_usuario ?? req.user.id;

    const commentCheck = await queryP(
      "SELECT id_usuario FROM EDI.Publicaciones_Comentarios WHERE id_comentario = @id",
      { id: { type: sql.Int, value: idComentario } },
    );

    if (!commentCheck.length) return notFound(res, "Comentario no encontrado");

    const idDueno = Number(commentCheck[0].id_usuario);
    const solicitanteNum = Number(idUsuarioSolicitante);
    const rolUsuario = (req.user.nombre_rol || req.user.rol || "").trim();
    const esAdmin = rolUsuario === "Admin";

    if (idDueno !== solicitanteNum && !esAdmin) {
      return res
        .status(403)
        .json({ message: "No puedes borrar este comentario" });
    }

    await queryP(
      "UPDATE EDI.Publicaciones_Comentarios SET activo = 0 WHERE id_comentario = @id",
      { id: { type: sql.Int, value: idComentario } },
    );

    req.io?.emit("feed_actualizado", { source: "publicaciones" });

    ok(res, { message: "Comentario eliminado" });
  } catch (e) {
    fail(res, e);
  }
};

exports.listGlobal = async (req, res) => {
  try {
    const idUsuarioActual = req.user.id_usuario ?? req.user.id;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = (page - 1) * limit;

    const posts = await queryP(Q.listGlobal, {
      current_user_id: { type: sql.Int, value: idUsuarioActual },
      offset: { type: sql.Int, value: offset },
      limit: { type: sql.Int, value: limit },
    });

    const eventos = page === 1 ? await queryP(AgendaQ.getActiveEvents) : [];
    const feed = [...(eventos || []), ...(posts || [])];

    ok(res, {
      page,
      limit,
      count: feed.length,
      hasMore: posts.length === limit,
      data: feed,
    });
  } catch (e) {
    fail(res, e);
  }
};
