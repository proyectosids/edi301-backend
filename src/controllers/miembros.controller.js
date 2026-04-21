const { sql, queryP, pool } = require('../dataBase/dbConnection');
const { ok, created, bad, fail } = require('../utils/http');
const { enviarNotificacionPush, enviarNotificacionMulticast } = require('../utils/firebase');

// ── Helper ────────────────────────────────────────────────────────────────
/** Devuelve { id_familia, nombre_familia } si el usuario ya está en otra familia activa */
async function _usuarioEnOtraFamilia(userId, excludeFamiliaId = null) {
  const params = { uid: { type: sql.Int, value: Number(userId) } };
  let q = `
    SELECT TOP 1 mf.id_familia, f.nombre_familia
    FROM EDI.Miembros_Familia mf
    JOIN EDI.Familias_EDI f ON f.id_familia = mf.id_familia
    WHERE mf.id_usuario = @uid
      AND mf.activo = 1
      AND f.activo = 1
  `;
  if (excludeFamiliaId) {
    q += ` AND mf.id_familia <> @excl`;
    params.excl = { type: sql.Int, value: Number(excludeFamiliaId) };
  }
  const rows = await queryP(q, params);
  return rows[0] ?? null;
}

async function add(req, res) {
  try {
    const { id_familia, id_usuario, tipo_miembro } = req.body;

    // Validar que el usuario no esté ya en otra familia activa
    const conflict = await _usuarioEnOtraFamilia(id_usuario, id_familia);
    if (conflict) {
      return res.status(409).json({
        ok: false,
        error: `Este usuario ya pertenece a la familia "${conflict.nombre_familia}". No puede estar en más de una familia.`,
        nombre_familia_existente: conflict.nombre_familia,
        id_familia_existente: conflict.id_familia,
      });
    }

    const rows = await queryP(`
      INSERT INTO EDI.Miembros_Familia (id_familia, id_usuario, tipo_miembro, activo, created_at)
      OUTPUT INSERTED.id_miembro
      VALUES (@id_familia, @id_usuario, @tipo_miembro, 1, SYSDATETIME());
    `, {
      id_familia:   { type: sql.Int, value: id_familia },
      id_usuario:   { type: sql.Int, value: id_usuario },
      tipo_miembro: { type: sql.NVarChar, value: tipo_miembro },
    });

    const nuevoMiembro = rows[0];

    // Tiempo real: Notificar a la familia que hay un nuevo integrante
    if (req.io) {
      req.io.to(`familia_${id_familia}`).emit('miembro_agregado', {
        id_familia,
        nuevoMiembro
      });
    }

    return created(res, nuevoMiembro);
  } catch (e) { fail(res, e); }
}

async function byFamilia(req, res) {
  try {
    const rows = await queryP(`SELECT * FROM dbo.Miembros_Familia WHERE id_familia = @id AND activo = 1`, { 
      id: { type: sql.Int, value: Number(req.params.id) }
    });
    return ok(res, rows);
  } catch (e) { fail(res, e); }
}

async function remove(req, res) {
  try {
    const id = Number(req.params.id);
    // Obtenemos el id_familia antes de borrar para notificar por socket
    const info = await queryP(`SELECT id_familia FROM EDI.Miembros_Familia WHERE id_miembro = @id`, { 
      id: { type: sql.Int, value: id }
    });

    await queryP(`DELETE FROM EDI.Miembros_Familia WHERE id_miembro = @id`, { 
      id: { type: sql.Int, value: id }
    });

    if (info[0] && req.io) {
      req.io.to(info[0].id_familia.toString()).emit('miembro_eliminado', { id_miembro: id });
    }

    return ok(res, { message: 'Eliminado' });
  } catch (e) { fail(res, e); }
}

async function addBulk(req, res) {
  const transaction = new sql.Transaction(pool);
  try {
    const { id_familia, id_usuarios } = req.body;
    const familiaRes = await queryP('SELECT nombre_familia FROM EDI.Familias_EDI WHERE id_familia = @id', {
        id: { type: sql.Int, value: id_familia }
    });
    const nombreFamilia = familiaRes[0]?.nombre_familia || 'Familia';

    // Validar conflictos ANTES de abrir la transacción
    const conflicts = [];
    for (const id_usuario of id_usuarios) {
      const c = await _usuarioEnOtraFamilia(id_usuario, id_familia);
      if (c) conflicts.push({ id_usuario, nombre_familia: c.nombre_familia });
    }
    if (conflicts.length > 0) {
      return res.status(409).json({
        ok: false,
        error: 'Algunos usuarios ya pertenecen a otra familia.',
        conflicts,
      });
    }

    await transaction.begin();
    for (const id_usuario of id_usuarios) {
      const request = new sql.Request(transaction);
      request.input('id_familia', sql.Int, id_familia);
      request.input('id_usuario', sql.Int, id_usuario);
      request.input('tipo_miembro', sql.NVarChar, 'ALUMNO_ASIGNADO');
      
      await request.query(`
        INSERT INTO EDI.Miembros_Familia (id_familia, id_usuario, tipo_miembro, activo, created_at) 
        VALUES (@id_familia, @id_usuario, @tipo_miembro, 1, SYSDATETIME())
      `);
    }
    await transaction.commit();

    // Tiempo real: Actualizar lista de miembros en los clientes conectados
    if (req.io) {
      req.io.to(`familia_${id_familia}`).emit('miembros_actualizados', { id_familia });
    }

    // Proceso de notificaciones (Push y DB)
    _enviarNotificacionesBulk(id_familia, id_usuarios, nombreFamilia);

    return ok(res, { message: `${id_usuarios.length} miembro(s) agregado(s) con éxito.` });
  } catch (e) {
    if (transaction.rolledBack === false) await transaction.rollback();
    fail(res, e);
  }
}

async function addAlumnosToFamilia(req, res) {
  const { id_familia } = req.params;
  const { matriculas = [] } = req.body;
  if (!Array.isArray(matriculas) || matriculas.length === 0) return bad(res, 'Faltan matrículas');

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const fRes = await new sql.Request(transaction).query(`SELECT nombre_familia FROM EDI.Familias_EDI WHERE id_familia = ${id_familia}`);
    const nombreFamilia = fRes.recordset[0]?.nombre_familia || 'Familia';
    
    const results = { added: [], notFound: [], errors: [], conflicts: [], usersNotif: [] };

    for (const matricula of matriculas) {
      try {
        const uRes = await new sql.Request(transaction).query(`SELECT id_usuario, fcm_token FROM EDI.Usuarios WHERE matricula = ${parseInt(matricula)}`);
        if (!uRes.recordset.length) { results.notFound.push(matricula); continue; }

        const user = uRes.recordset[0];

        // Validar que el usuario no esté en otra familia
        const conflict = await _usuarioEnOtraFamilia(user.id_usuario, id_familia);
        if (conflict) {
          results.conflicts.push({ matricula, nombre_familia: conflict.nombre_familia });
          continue;
        }

        const mReq = new sql.Request(transaction);
        mReq.input('idF', sql.Int, id_familia);
        mReq.input('idU', sql.Int, user.id_usuario);
        await mReq.query(`
          IF NOT EXISTS (SELECT 1 FROM EDI.Miembros_Familia WHERE id_familia = @idF AND id_usuario = @idU)
          BEGIN
            INSERT INTO EDI.Miembros_Familia (id_familia, id_usuario, tipo_miembro, activo, created_at)
            VALUES (@idF, @idU, 'HIJO', 1, SYSDATETIME())
          END
        `);
        results.added.push(matricula);
        results.usersNotif.push(user); 
      } catch (err) { results.errors.push(`Matrícula ${matricula}: ${err.message}`); }
    }
    await transaction.commit();

    // Tiempo Real
    if (req.io && results.added.length > 0) {
      req.io.to(`familia_${id_familia}`).emit('nuevos_alumnos_asignados', { 
        id_familia, 
        cantidad: results.added.length 
      });
    }

    // Notificaciones externas
    _enviarNotificacionesAlumnos(id_familia, results.usersNotif, nombreFamilia, results.added.length);

    return ok(res, { added: results.added, notFound: results.notFound, errors: results.errors, conflicts: results.conflicts });
  } catch (e) {
    if (transaction.rolledBack === false) await transaction.rollback();
    fail(res, e);
  }
}

// Funciones auxiliares para no saturar el controlador principal
async function _enviarNotificacionesBulk(id_familia, id_usuarios, nombreFamilia) {
    try {
        const ids = id_usuarios.map(id => Number(id)).filter(id => !isNaN(id));
        if (ids.length === 0) return;
        
        const usersData = await queryP(`SELECT id_usuario, fcm_token FROM EDI.Usuarios WHERE id_usuario IN (${ids.join(',')})`);
        const tokensDestino = [];

        for (const u of usersData) {
            queryP(`INSERT INTO EDI.Notificaciones (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
                    VALUES (@uid, @tit, @body, 'ASIGNACION', @ref, 0, GETUTCDATE())`, {
                uid: { type: sql.Int, value: u.id_usuario },
                tit: { type: sql.NVarChar, value: 'Nueva Asignación 🎒' },
                body: { type: sql.NVarChar, value: `Has sido asignado a la familia "${nombreFamilia}".` },
                ref: { type: sql.Int, value: id_familia }
            }).catch(e => console.error("Error BD Notif:", e.message));
            if (u.fcm_token) tokensDestino.push(u.fcm_token);
        }
        if (tokensDestino.length > 0) {
            enviarNotificacionMulticast(tokensDestino, 'Nueva Asignación 🎒', `Has sido asignado a la familia "${nombreFamilia}".`, 
            { tipo: 'ASIGNACION', id_familia: id_familia.toString() });
        }
    } catch (e) { console.error("Error en notificaciones bulk:", e); }
}

async function _enviarNotificacionesAlumnos(id_familia, usersNotif, nombreFamilia, cantidad) {
    // Notificar a alumnos
    for (const u of usersNotif) {
        const tit = 'Nueva Asignación 🎒';
        const body = `Has sido asignado a la ${nombreFamilia}.`;
        queryP(`INSERT INTO EDI.Notificaciones (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
                VALUES (@uid, @tit, @body, 'ASIGNACION', @ref, 0, GETUTCDATE())`, {
            uid: { type: sql.Int, value: u.id_usuario },
            tit: { type: sql.NVarChar, value: tit },
            body: { type: sql.NVarChar, value: body },
            ref: { type: sql.Int, value: id_familia }
        });
        if (u.fcm_token) enviarNotificacionPush(u.fcm_token, tit, body, { tipo: 'ASIGNACION', id_familia: id_familia.toString() });
    }

    // Notificar a los padres de la familia
    try {
        const padres = await queryP(`
            SELECT u.id_usuario, u.fcm_token FROM EDI.Miembros_Familia mf
            JOIN EDI.Usuarios u ON mf.id_usuario = u.id_usuario
            JOIN EDI.Roles r ON u.id_rol = r.id_rol
            WHERE mf.id_familia = @idFam AND mf.activo = 1
            AND r.nombre_rol IN ('Padre', 'Madre', 'Tutor', 'PapaEDI', 'MamaEDI')
        `, { idFam: { type: sql.Int, value: id_familia } });

        const tokensP = [];
        for (const p of padres) {
            queryP(`INSERT INTO EDI.Notificaciones (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
                    VALUES (@uid, 'Nuevos Miembros 👶', @body, 'NUEVO_MIEMBRO', @ref, 0, GETUTCDATE())`, {
                uid: { type: sql.Int, value: p.id_usuario },
                body: { type: sql.NVarChar, value: `Se han asignado ${cantidad} nuevos alumnos a tu familia.` },
                ref: { type: sql.Int, value: id_familia }
            });
            if (p.fcm_token) tokensP.push(p.fcm_token);
        }
        if (tokensP.length > 0) {
            enviarNotificacionMulticast(tokensP, 'Nuevos Miembros 👶', `Se han asignado ${cantidad} nuevos alumnos a tu familia.`, { tipo: 'NUEVO_MIEMBRO', id_familia: id_familia.toString() });
        }
    } catch(e) { console.error("Error notif padres:", e); }
}

module.exports = { add, byFamilia, remove, addAlumnosToFamilia, addBulk };