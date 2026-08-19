// ============================================================================
// controllers/renovaciones.controller.js
//
// Flujo de renovación de pertenencia de alumnos a sus familias por ciclo
// escolar. Pensado para usarse al cierre/inicio de ciclo escolar.
// ============================================================================
const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, bad, fail, notFound } = require('../utils/http');
const { Q } = require('../queries/renovaciones.queries');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificacion, insertarNotificaciones } = require('../utils/notificaciones');
const { getActiveFcmTokensForUsers } = require('../utils/sessions');

const CONFIG_KEY = 'renovacion_ciclo_abierta';

// Helper: lee la config de la ventana.
async function isVentanaAbierta() {
  const rows = await queryP(Q.getConfig, {
    clave: { type: sql.NVarChar, value: CONFIG_KEY },
  });
  if (!rows.length) return false;
  return String(rows[0].valor || '').toLowerCase() === 'true';
}

// Helper: asegura que el caller es admin.
function isAdmin(req) {
  const rol = (req.user && req.user.nombre_rol) || '';
  return /admin/i.test(rol);
}

// ============================================================================
// PUBLIC: estado de la ventana (cualquier usuario autenticado).
// GET /api/renovaciones/estado
// ============================================================================
exports.getEstadoVentana = async (req, res) => {
  try {
    const abierta = await isVentanaAbierta();
    ok(res, { renovacion_abierta: abierta });
  } catch (e) {
    fail(res, e);
  }
};

// ============================================================================
// ALUMNO: solicitar renovación de la familia actual.
// POST /api/renovaciones/solicitar
// ============================================================================
exports.solicitarRenovacion = async (req, res) => {
  try {
    const idAlumno = req.user && req.user.id_usuario;
    if (!idAlumno) return bad(res, 'No autenticado');

    if (!(await isVentanaAbierta())) {
      return bad(res, 'La ventana de renovación no está abierta.');
    }

    // Encontrar familia actual del alumno.
    const fam = await queryP(Q.getCurrentFamilyOfAlumno, {
      id_usuario: { type: sql.Int, value: Number(idAlumno) },
    });
    if (!fam.length) return bad(res, 'No perteneces a ninguna familia activa.');

    const { id_familia, renovacion_aprobada_at } = fam[0];

    if (renovacion_aprobada_at) {
      return bad(res, 'Tu renovación ya fue aceptada.');
    }

    // ¿Ya hay solicitud pendiente?
    const pending = await queryP(Q.alumnoHasPendingRenovacion, {
      id_usuario: { type: sql.Int, value: Number(idAlumno) },
      id_familia: { type: sql.Int, value: Number(id_familia) },
    });
    if (pending.length) {
      return bad(res, 'Ya tienes una solicitud de renovación pendiente.');
    }

    // Crear solicitud
    const ins = await queryP(Q.insertRenovacionRequest, {
      id_familia: { type: sql.Int, value: Number(id_familia) },
      id_usuario: { type: sql.Int, value: Number(idAlumno) },
    });

    // Notificar a padres/tutores de la familia
    const tutores = await queryP(`
      SELECT u.id_usuario
      FROM EDI.Usuarios u
      JOIN EDI.Miembros_Familia mf ON mf.id_usuario = u.id_usuario AND mf.activo = 1
      JOIN EDI.Roles r ON r.id_rol = u.id_rol
      WHERE mf.id_familia = @id_familia
        AND u.activo = 1
        AND r.nombre_rol IN ('Padre', 'Madre', 'Tutor', 'Admin', 'PapaEDI', 'MamaEDI')
    `, { id_familia: { type: sql.Int, value: Number(id_familia) } });

    const idsTutores = tutores.map(t => t.id_usuario);
    const nombreAlumno = `${req.user.nombre || ''} ${req.user.apellido || ''}`.trim();

    // Notificación en historial
    await insertarNotificaciones(
      idsTutores,
      '🔄 Solicitud de renovación',
      `${nombreAlumno} solicita renovar su pertenencia a la familia para el próximo ciclo.`,
      'RENOVACION_CICLO',
      ins[0].id_solicitud,
    ).catch(() => {});

    // Push multi-dispositivo
    const tokens = await getActiveFcmTokensForUsers(idsTutores);
    if (tokens.length > 0) {
      await enviarNotificacionMulticast(
        tokens,
        '🔄 Solicitud de renovación',
        `${nombreAlumno} solicita renovar su familia para el próximo ciclo.`,
        { tipo: 'RENOVACION_CICLO', id_solicitud: String(ins[0].id_solicitud) },
      );
    }

    ok(res, { message: 'Solicitud enviada', id_solicitud: ins[0].id_solicitud });
  } catch (e) {
    console.error('solicitarRenovacion error:', e);
    fail(res, e);
  }
};

// ============================================================================
// PADRE/TUTOR: listar pendientes en TODAS las familias del usuario.
// GET /api/renovaciones/mis-pendientes
// ============================================================================
exports.listMisPendientes = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    if (!idUsuario) return bad(res, 'No autenticado');

    const rows = await queryP(Q.listPendingRenovacionesForTutor, {
      id_usuario: { type: sql.Int, value: Number(idUsuario) },
    });
    ok(res, rows);
  } catch (e) {
    console.error('listMisPendientes error:', e);
    fail(res, e);
  }
};

// ============================================================================
// PADRE/TUTOR: listar pendientes de SU familia.
// GET /api/renovaciones/familia/:id_familia/pendientes
// ============================================================================
exports.listPendientesFamilia = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    const idFamilia = Number(req.params.id_familia);

    if (!idUsuario) return bad(res, 'No autenticado');
    if (!Number.isInteger(idFamilia) || idFamilia <= 0) {
      return bad(res, 'id_familia inválido');
    }

    const okTutor = await queryP(Q.esTutorDeFamilia, {
      id_familia: { type: sql.Int, value: idFamilia },
      id_usuario: { type: sql.Int, value: Number(idUsuario) },
    });
    if (!okTutor.length && !isAdmin(req)) {
      return res.status(403).json({ error: 'No tienes permiso sobre esta familia' });
    }

    const rows = await queryP(Q.listPendingRenovacionesForFamilia, {
      id_familia: { type: sql.Int, value: idFamilia },
    });
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

// ============================================================================
// PADRE/TUTOR: responder solicitud (aceptar / rechazar)
// POST /api/renovaciones/:id_solicitud/responder  body: { accion: 'aceptar' | 'rechazar' }
// ============================================================================
exports.responderRenovacion = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    const idSolicitud = Number(req.params.id_solicitud);
    const accion = (req.body && req.body.accion || '').toString().toLowerCase();

    if (!idUsuario) return bad(res, 'No autenticado');
    if (!['aceptar', 'rechazar'].includes(accion)) {
      return bad(res, "accion debe ser 'aceptar' o 'rechazar'");
    }

    // Obtener la solicitud
    const sol = await queryP(Q.getRenovacionById, {
      id_solicitud: { type: sql.Int, value: idSolicitud },
    });
    if (!sol.length) return notFound(res);

    const { id_familia, id_alumno, estado } = sol[0];
    if (estado !== 'Pendiente') {
      return bad(res, 'La solicitud ya fue resuelta.');
    }

    // Validar que sea tutor de la familia (o admin)
    const okTutor = await queryP(Q.esTutorDeFamilia, {
      id_familia: { type: sql.Int, value: id_familia },
      id_usuario: { type: sql.Int, value: Number(idUsuario) },
    });
    if (!okTutor.length && !isAdmin(req)) {
      return res.status(403).json({ error: 'No tienes permiso sobre esta familia' });
    }

    const nuevoEstado = accion === 'aceptar' ? 'Aceptada' : 'Rechazada';

    // Update de la solicitud
    const upd = await queryP(Q.setEstadoRenovacion, {
      id_solicitud: { type: sql.Int, value: idSolicitud },
      estado:       { type: sql.NVarChar, value: nuevoEstado },
    });
    if (!upd.length) return bad(res, 'No se pudo actualizar la solicitud');

    if (accion === 'aceptar') {
      // Marca al alumno como renovado en su membresía actual.
      await queryP(Q.marcarMiembroRenovado, {
        id_familia: { type: sql.Int, value: id_familia },
        id_usuario: { type: sql.Int, value: id_alumno },
      });

      // Cualquier otra solicitud pendiente del mismo alumno se cierra como aceptada.
      await queryP(Q.cerrarOtrasRenovacionesDelAlumno, {
        id_alumno:              { type: sql.Int, value: id_alumno },
        id_solicitud_actual:    { type: sql.Int, value: idSolicitud },
      });
    }

    // Notificar al alumno
    const titulo = accion === 'aceptar'
      ? '✅ Renovación aceptada'
      : '❌ Renovación rechazada';
    const cuerpo = accion === 'aceptar'
      ? 'Tu renovación de familia fue aceptada para el próximo ciclo.'
      : 'Tu renovación fue rechazada por un padre/tutor de la familia.';

    await insertarNotificacion(id_alumno, titulo, cuerpo, 'RENOVACION_CICLO', idSolicitud)
      .catch(() => {});

    const tokens = await getActiveFcmTokensForUsers([id_alumno]);
    if (tokens.length > 0) {
      await enviarNotificacionMulticast(tokens, titulo, cuerpo, {
        tipo: 'RENOVACION_CICLO_RESPUESTA',
        id_solicitud: String(idSolicitud),
        accion,
      });
    }

    ok(res, { message: 'Solicitud actualizada', estado: nuevoEstado });
  } catch (e) {
    console.error('responderRenovacion error:', e);
    fail(res, e);
  }
};

// ============================================================================
// ADMIN: abrir / cerrar ventana
// POST /api/renovaciones/admin/ventana  body: { abrir: true|false }
// ============================================================================
exports.setVentana = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo admin' });
    const abrir = !!(req.body && req.body.abrir);

    await queryP(Q.upsertConfig, {
      clave:       { type: sql.NVarChar, value: CONFIG_KEY },
      valor:       { type: sql.NVarChar, value: abrir ? 'true' : 'false' },
      descripcion: { type: sql.NVarChar, value: 'Ventana de renovación de familias' },
    });

    ok(res, { renovacion_abierta: abrir });
  } catch (e) {
    fail(res, e);
  }
};

// ============================================================================
// ADMIN: listar todas las renovaciones (panel)
// GET /api/renovaciones/admin
// ============================================================================
exports.listAdmin = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo admin' });
    const rows = await queryP(Q.listAllRenovaciones, {});

    const counts = await queryP(Q.contarMiembrosAlumnos, {});
    const stats = counts[0] || { total_alumnos: 0, alumnos_renovados: 0 };

    ok(res, {
      total_alumnos:     stats.total_alumnos     || 0,
      alumnos_renovados: stats.alumnos_renovados || 0,
      solicitudes:       rows,
    });
  } catch (e) {
    fail(res, e);
  }
};

// ============================================================================
// ADMIN: vaciar familias (remueve a alumnos NO renovados)
// POST /api/renovaciones/admin/vaciar
// ============================================================================
exports.vaciarFamilias = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Solo admin' });

    // Los cuatro cambios del cierre de ciclo deben confirmarse juntos.
    const removidos = await queryP(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      DECLARE @removidos TABLE (id_usuario INT, id_familia INT);

      UPDATE EDI.Miembros_Familia
      SET activo = 0, updated_at = GETUTCDATE()
      OUTPUT DELETED.id_usuario, DELETED.id_familia INTO @removidos
      WHERE activo = 1
        AND tipo_miembro IN ('Alumno','ALUMNO','HIJO','Hijo')
        AND renovacion_aprobada_at IS NULL;

      UPDATE EDI.Miembros_Familia
      SET renovacion_aprobada_at = NULL, updated_at = GETUTCDATE()
      WHERE activo = 1 AND renovacion_aprobada_at IS NOT NULL;

      UPDATE EDI.Solicitudes_Familia
      SET activo = 0, updated_at = GETUTCDATE()
      WHERE tipo_solicitud = 'RENOVACION_CICLO' AND activo = 1;

      IF EXISTS (SELECT 1 FROM EDI.App_Config WHERE clave = @clave)
        UPDATE EDI.App_Config SET valor = @valor, updated_at = GETUTCDATE() WHERE clave = @clave;
      ELSE
        INSERT INTO EDI.App_Config (clave, valor, descripcion) VALUES (@clave, @valor, @descripcion);

      COMMIT TRANSACTION;
      SELECT id_usuario, id_familia FROM @removidos;
    `, {
      clave:       { type: sql.NVarChar, value: CONFIG_KEY },
      valor:       { type: sql.NVarChar, value: 'false' },
      descripcion: { type: sql.NVarChar, value: 'Ventana de renovación de familias' },
    });

    // 5) Notificar a los alumnos removidos.
    const idsRemovidos = [...new Set(removidos.map(r => r.id_usuario))];
    await insertarNotificaciones(
      idsRemovidos,
      '👋 Cambio de ciclo escolar',
      'Tu pertenencia a la familia se cerró por inicio de un nuevo ciclo escolar. ¡Te esperamos en una nueva familia!',
      'CICLO_CERRADO',
      null,
    ).catch(() => {});
    const tokens = await getActiveFcmTokensForUsers(idsRemovidos);
    if (tokens.length > 0) {
      await enviarNotificacionMulticast(
        tokens,
        '👋 Cambio de ciclo escolar',
        'Tu pertenencia a la familia se cerró por inicio del nuevo ciclo.',
        { tipo: 'CICLO_CERRADO' },
      );
    }

    ok(res, {
      message: 'Familias vaciadas correctamente',
      alumnos_removidos: idsRemovidos.length,
    });
  } catch (e) {
    console.error('vaciarFamilias error:', e);
    fail(res, e);
  }
};
