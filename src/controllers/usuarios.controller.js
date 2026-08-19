const { getImagenCumpleanos, setImagenCumpleanos } = require('../services/birthday.service');
const { sql, queryP } = require('../dataBase/dbConnection');
const { createUserSchema, updateUserSchema } = require('../models/usuario.model');
const { hashPassword } = require('../utils/hash');
const { ok, created, bad, fail, notFound } = require('../utils/http');
const UQ = require('../queries/usuarios.queries').Q;
const FamiliasQ = require('../queries/familias.queries').Q;
const { saveOptimizedProfilePhoto } = require('../utils/imageStorage');

exports.create = async (req, res) => {

  let responded = false;

  try {

    const { error, value } = createUserSchema.validate(req.body);
    if (error) return bad(res, 'Datos inválidos: ' + error.message);


    const hashed = await hashPassword(value.contrasena);

    const nombreFormateado = formatSpanishName(value.nombre);
    const apellidoFormateado = formatSpanishName(value.apellido);
    const params = {
      nombre:   { type: sql.NVarChar, value: nombreFormateado },
      apellido: { type: sql.NVarChar, value: apellidoFormateado ?? null },
      correo:          { type: sql.NVarChar, value: value.correo },
      contrasena:      { type: sql.NVarChar, value: hashed },
      foto_perfil:     { type: sql.NVarChar, value: value.foto_perfil ?? null },
      tipo_usuario:    { type: sql.NVarChar, value: value.tipo_usuario },
      matricula:       { type: sql.Int,      value: value.matricula ?? null },
      num_empleado:    { type: sql.Int,      value: value.num_empleado ?? null },
      id_rol:          { type: sql.Int,      value: value.id_rol },
      telefono:        { type: sql.NVarChar, value: value.telefono ?? null },
      residencia:      { type: sql.NVarChar, value: value.residencia ?? null },
      direccion:       { type: sql.NVarChar, value: value.direccion ?? null },
      fecha_nacimiento:{ type: sql.Date,     value: value.fecha_nacimiento ?? null },
      carrera:         { type: sql.NVarChar, value: value.carrera ?? null },
    };


    const rows = await queryP(UQ.insert, params);
    
    if (!rows || rows.length === 0) {
        responded = true;
        return fail(res, 'La base de datos no devolvió el usuario creado.');
    }

    const user = rows[0];
    delete user.contrasena;


    const newUserId = user.id_usuario || user.IdUsuario || user.idUsuario;

    // ── Buscar familias "manuales" pendientes que matcheen este usuario ─────
    // Solo aplica si el rol es PapaEDI (2) o MamaEDI (3). El frontend usará
    // este array para mostrar el modal "Elige tu familia" después del registro.
    user.familia_candidatos = [];
    try {
      const idRol = Number(value.id_rol);
      let rolMatch = null;
      if (idRol === 2) rolMatch = 'PAPA';
      else if (idRol === 3) rolMatch = 'MAMA';

      if (rolMatch) {
        const candidatos = await queryP(FamiliasQ.findCandidatesForUser, {
          rol:      { type: sql.NVarChar, value: rolMatch },
          nombre:   { type: sql.NVarChar, value: nombreFormateado },
          apellido: { type: sql.NVarChar, value: apellidoFormateado },
        });
        user.familia_candidatos = candidatos || [];
      }
    } catch (matchErr) {
      // No bloquear el registro si la búsqueda falla
      console.error('familia_candidatos (no bloqueante):', matchErr.message);
    }

    responded = true;
    created(res, user);


    if (newUserId) {

        setImmediate(() => {
            integrateUserToChat(newUserId, value.id_rol).catch(err => {
                console.error(" Error silencioso en chat:", err.message);
            });
        });
    }

  } catch (e) {
    console.error(" Error en exports.create:", e);
    

    if (responded) return;

    if (e.number === 2627 || e.message.includes('UNIQUE KEY')) {
        return bad(res, 'El correo ya está registrado.');
    }
    return fail(res, e);
  }
};


async function integrateUserToChat(userId, idRol) {
    const autoChatQuery = `
        DECLARE @RoleName nvarchar(50) = (SELECT nombre_rol FROM EDI.Roles WHERE id_rol = @idRol);
        IF @RoleName IN ('Padre', 'Madre', 'Tutor', 'PapaEDI', 'MamaEDI')
        BEGIN
            DECLARE @IdSala int = (SELECT TOP 1 id_sala FROM EDI.Chat_Salas WHERE nombre = 'Comunidad de Padres');
            IF @IdSala IS NOT NULL
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM EDI.Chat_Participantes WHERE id_sala = @IdSala AND id_usuario = @idUsuario)
                BEGIN
                    INSERT INTO EDI.Chat_Participantes (id_sala, id_usuario, es_admin)
                    VALUES (@IdSala, @idUsuario, 0); 
                END
            END
        END
    `;
    await queryP(autoChatQuery, {
        idRol: { type: sql.Int, value: idRol },
        idUsuario: { type: sql.Int, value: userId }
    });
    console.log(`[BACKEND SUCCESS] Usuario ${userId} verificado en comunidad de padres.`);
}



exports.searchUsers = async (req, res) => {
  try {
    const tipo = (req.query.tipo || '').toUpperCase();
    const q = (req.query.q || '').trim();

    if (!['ALUMNO', 'EMPLEADO','EXTERNO'].includes(tipo)) {
      return res.json([]);
    }

    const isNumeric = /^\d+$/.test(q);
    const like = `%${q}%`;

    const baseSelect = `
      SELECT
        u.id_usuario      AS IdUsuario,
        u.nombre          AS Nombre,
        u.apellido        AS Apellido,
        u.tipo_usuario    AS TipoUsuario,
        u.matricula       AS Matricula,
        u.num_empleado    AS NumEmpleado,
        u.correo          AS E_mail,
        u.foto_perfil     AS FotoPerfil
      FROM EDI.Usuarios u
      WHERE u.tipo_usuario = @tipo
    `;

    let sqlText = '';
    const params = {
      tipo: { type: sql.NVarChar, value: tipo },
      like: { type: sql.NVarChar, value: like },
    };

    if (isNumeric) {
      if (tipo === 'ALUMNO') {
        sqlText = `${baseSelect} AND CAST(u.matricula AS NVARCHAR(50)) LIKE @like ORDER BY u.nombre, u.apellido`;
      } else {
        sqlText = `${baseSelect} AND CAST(u.num_empleado AS NVARCHAR(50)) LIKE @like ORDER BY u.nombre, u.apellido`;
      }
    } else {
      sqlText = `${baseSelect} AND (u.nombre LIKE @like OR u.apellido LIKE @like) ORDER BY u.nombre, u.apellido`;
    }

    const rows = await queryP(sqlText, params);
    res.json(rows);
  } catch (e) {
    console.error('searchUsers', e);
    res.status(500).json([]);
  }
};

exports.update = async (req, res) => {
  try {
    let rutaFoto = null;
if (req.files && req.files.foto) {
  try {
    rutaFoto = await saveOptimizedProfilePhoto(req.files.foto, req.params.id);
  } catch (imgErr) {
    return bad(res, imgErr.message || 'Error procesando imagen');
  }
}



    const { error, value } = updateUserSchema
      .prefs({ abortEarly: false, allowUnknown: true })
      .validate(req.body);

    if (error) return bad(res, 'Datos inválidos: ' + error.message);
    const nn = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) ? null : v;
    let fechaDate = null;
    if (value.fecha_nacimiento) {
      let iso = String(value.fecha_nacimiento).trim();
      const m = iso.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) fechaDate = d;
    }

    const fotoFinal = rutaFoto ? rutaFoto : nn(value.foto_perfil);
    const params = {
      id_usuario:       { type: sql.Int,      value: Number(req.params.id) },
      nombre:           { type: sql.NVarChar, value: nn(value.nombre) },
      apellido:         { type: sql.NVarChar, value: nn(value.apellido) },
      foto_perfil:      { type: sql.NVarChar, value: fotoFinal },
      estado:           { type: sql.NVarChar, value: nn(value.estado) },
      activo:           { type: sql.Bit,      value: value.activo === undefined ? null : (value.activo ? 1 : 0) },
      telefono:         { type: sql.NVarChar, value: nn(value.telefono) },
      residencia:       { type: sql.NVarChar, value: nn(value.residencia) },
      direccion:        { type: sql.NVarChar, value: nn(value.direccion) },
      fecha_nacimiento: { type: sql.Date,     value: fechaDate },
      carrera:          { type: sql.NVarChar, value: nn(value.carrera) },
    };

    const rows = await queryP(UQ.updateBasic, params);
    if (!rows.length) return notFound(res);

    const user = rows[0];
    delete user.contrasena;
    ok(res, user);
  } catch (e) {
    console.error('usuarios.update error:', e?.originalError?.info?.message || e);
    fail(res, e);
  }
};

exports.list = async (_req, res) => {
  try { ok(res, await queryP(UQ.list)); } catch (e) { fail(res, e); }
};

exports.get = async (req, res) => {
  try {
    const rows = await queryP(UQ.byId, { id_usuario: { type: sql.Int, value: Number(req.params.id) } });
    if (!rows.length) return notFound(res);
    const user = rows[0]; delete user.contrasena;
    ok(res, user);
  } catch (e) { fail(res, e); }
};

exports.remove = async (req, res) => {
  try {
    await queryP(UQ.softDelete, { id_usuario: { type: sql.Int, value: Number(req.params.id) } });
    ok(res, { message: 'Usuario desactivado' });
  } catch (e) { fail(res, e); }
};

// Self-deactivation: desactiva la cuenta del usuario autenticado y libera
// el correo, matrícula y núm. empleado para permitir un nuevo registro.
// Las relaciones existentes (familia, mensajes, publicaciones) se conservan.
exports.deactivateMyAccount = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    if (!idUsuario) return bad(res, 'No autenticado');

    const rows = await queryP(UQ.selfDeactivate, {
      id_usuario: { type: sql.Int, value: Number(idUsuario) }
    });

    if (!rows.length) {
      // o ya estaba desactivada o no existe
      return bad(res, 'La cuenta no existe o ya estaba desactivada');
    }

    // Cierra todas las sesiones (multi-dispositivo) del usuario.
    await queryP(UQ.deactivateAllSessionsOfUser, {
      id_usuario: { type: sql.Int, value: Number(idUsuario) }
    });

    ok(res, {
      message: 'Cuenta desactivada correctamente',
      id_usuario: rows[0].id_usuario,
    });
  } catch (e) {
    console.error('deactivateMyAccount error:', e);
    fail(res, e);
  }
};

exports.updateEmail = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { correo } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'Id inválido');
    if (!correo || typeof correo !== 'string' || !/^\S+@\S+\.\S+$/.test(correo)) {
      return bad(res, 'Correo inválido');
    }

    const dup = await queryP(`
      SELECT 1 FROM EDI.Usuarios WHERE correo = @correo AND id_usuario <> @id
    `, { correo: { type: sql.NVarChar, value: correo }, id: { type: sql.Int, value: id } });
    if (dup.length) return bad(res, 'El correo ya está en uso');

    const rows = await queryP(`
      UPDATE EDI.Usuarios
      SET correo = @correo, updated_at = GETDATE()
      OUTPUT INSERTED.id_usuario      AS IdUsuario,
             INSERTED.nombre          AS Nombre,
             INSERTED.apellido        AS Apellido,
             INSERTED.tipo_usuario    AS TipoUsuario,
             INSERTED.matricula       AS Matricula,
             INSERTED.num_empleado    AS NumEmpleado,
             INSERTED.correo          AS E_mail,
             INSERTED.estado          AS Estado
      WHERE id_usuario = @id
    `, { correo: { type: sql.NVarChar, value: correo }, id: { type: sql.Int, value: id } });

    if (!rows.length) return notFound(res);
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
};

exports.updateToken = async (req, res) => {
  try {
    const { fcm_token, token, session_token } = req.body;
    const id_usuario = req.user && req.user.id_usuario;

    // acepta varias llaves para no romper clientes viejos
    const incomingToken = fcm_token || token || session_token;

    if (!id_usuario || !incomingToken) {
      return bad(res, 'Falta el token de notificaciones o no estás autenticado');
    }

    // Cada dispositivo guarda el token en su propia sesión autenticada.
    if (req.session && req.session.id_sesion) {
      await queryP(UQ.updateSessionFcmToken, {
        id_sesion: { type: sql.Int,      value: req.session.id_sesion },
        fcm_token: { type: sql.NVarChar, value: incomingToken },
      });
    }

    // Compatibilidad: también actualiza el campo legacy en EDI.Usuarios
    // para que cualquier consulta vieja siga viendo "algún" token mientras
    // se completa la migración del resto del código.
    await queryP(UQ.updateFcm, {
      id_usuario: { type: sql.Int,      value: Number(id_usuario) },
      token:      { type: sql.NVarChar, value: incomingToken },
    });

    return ok(res, { msg: 'Token actualizado correctamente' });
  } catch (e) {
    console.error('Error actualizando token:', e);
    return fail(res, e);
  }
};

// ===========================================================================
// SESIONES MULTI-DISPOSITIVO
// ===========================================================================

// Lista las sesiones activas del usuario autenticado (pantalla "Mis dispositivos").
exports.listMySessions = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    if (!idUsuario) return bad(res, 'No autenticado');

    const rows = await queryP(UQ.listMySessions, {
      id_usuario: { type: sql.Int, value: Number(idUsuario) },
    });

    const idSesionActual = req.session ? req.session.id_sesion : null;
    const sesiones = rows.map(s => ({
      id_sesion:      s.id_sesion,
      device_info:    s.device_info,
      platform:       s.platform,
      ip_address:     s.ip_address,
      created_at:     s.created_at,
      last_active_at: s.last_active_at,
      es_actual:      s.id_sesion === idSesionActual,
    }));

    ok(res, sesiones);
  } catch (e) {
    console.error('listMySessions error:', e);
    fail(res, e);
  }
};

// Cierra una sesión específica del usuario autenticado.
exports.revokeSession = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    const idSesion = Number(req.params.id);

    if (!idUsuario) return bad(res, 'No autenticado');
    if (!Number.isInteger(idSesion) || idSesion <= 0) {
      return bad(res, 'id de sesión inválido');
    }

    const rs = await queryP(UQ.revokeSession, {
      id_sesion:  { type: sql.Int, value: idSesion },
      id_usuario: { type: sql.Int, value: Number(idUsuario) },
    });

    if (!rs.length) {
      return bad(res, 'La sesión no existe o no te pertenece');
    }

    ok(res, { message: 'Sesión cerrada', id_sesion: rs[0].id_sesion });
  } catch (e) {
    console.error('revokeSession error:', e);
    fail(res, e);
  }
};

// Cierra TODAS las sesiones del usuario excepto la que está haciendo la request.
exports.revokeAllOtherSessions = async (req, res) => {
  try {
    const idUsuario = req.user && req.user.id_usuario;
    const idSesionActual = req.session && req.session.id_sesion;

    if (!idUsuario || !idSesionActual) return bad(res, 'No autenticado');

    const rs = await queryP(UQ.revokeAllOtherSessions, {
      id_usuario:        { type: sql.Int, value: Number(idUsuario) },
      id_sesion_actual:  { type: sql.Int, value: Number(idSesionActual) },
    });

    ok(res, {
      message: 'Otras sesiones cerradas',
      cerradas: rs.length,
    });
  } catch (e) {
    console.error('revokeAllOtherSessions error:', e);
    fail(res, e);
  }
};

exports.getBirthdays = async (req, res) => {
  try {
    const rango = (req.query.rango || 'hoy').toLowerCase();
    let query;
    if (rango === 'proximos') query = UQ.birthdaysUpcoming;
    else if (rango === 'pasados') query = UQ.birthdaysPast;
    else query = UQ.birthdaysToday;
    const rows = await queryP(query);
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
};

function formatSpanishName(text) {
  if (!text) return text;

  const lowerWords = [
    'de',
    'del',
    'la',
    'las',
    'los',
    'y',
    'da',
    'dos',
    'van',
    'von',
  ];

  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word, index) => {
      if (lowerWords.includes(word) && index !== 0) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
exports.getImagenCumpleanos = (req, res) => {
  ok(res, { imagen: getImagenCumpleanos() });
};

exports.setImagenCumpleanos = (req, res) => {
  const { imagen_url } = req.body;
  if (!imagen_url) return bad(res, 'imagen_url es requerida');
  setImagenCumpleanos(imagen_url);
  ok(res, { ok: true, imagen: getImagenCumpleanos() });
};

exports.buscarPorIdent = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const isNumeric = /^\d+$/.test(q);

    let sqlText;
    const params = { like: { type: sql.NVarChar, value: like } };

    if (isNumeric) {
      sqlText = `
        SELECT u.id_usuario, u.nombre, u.apellido, u.correo, u.tipo_usuario,
               u.matricula, u.num_empleado, u.id_rol, r.nombre_rol, u.foto_perfil
        FROM EDI.Usuarios u
        JOIN EDI.Roles r ON r.id_rol = u.id_rol
        WHERE u.activo = 1
          AND (CAST(u.matricula AS NVARCHAR) LIKE @like
               OR CAST(u.num_empleado AS NVARCHAR) LIKE @like)
        ORDER BY u.nombre
      `;
    } else {
      sqlText = `
        SELECT u.id_usuario, u.nombre, u.apellido, u.correo, u.tipo_usuario,
               u.matricula, u.num_empleado, u.id_rol, r.nombre_rol, u.foto_perfil
        FROM EDI.Usuarios u
        JOIN EDI.Roles r ON r.id_rol = u.id_rol
        WHERE u.activo = 1
          AND (u.nombre LIKE @like OR u.apellido LIKE @like)
        ORDER BY u.nombre
      `;
    }

    const rows = await queryP(sqlText, params);
    res.json(rows);
  } catch (e) {
    console.error('buscarPorIdent error:', e);
    res.status(500).json([]);
  }
};

exports.cambiarRol = async (req, res) => {
  try {
    const { id_usuario, id_rol } = req.body;
    if (!id_usuario) return bad(res, 'Se requiere id_usuario');

    // id_rol opcional: default 1 (Admin) para retrocompatibilidad
    const targetRol = id_rol ? Number(id_rol) : 1;

    const rows = await queryP(`
      UPDATE EDI.Usuarios
      SET id_rol = @id_rol, updated_at = GETDATE()
      OUTPUT INSERTED.id_usuario AS IdUsuario,
             INSERTED.nombre     AS Nombre,
             INSERTED.apellido   AS Apellido,
             INSERTED.correo     AS E_mail,
             INSERTED.tipo_usuario AS TipoUsuario,
             INSERTED.matricula  AS Matricula,
             INSERTED.num_empleado AS NumEmpleado,
             INSERTED.id_rol     AS IdRol
      WHERE id_usuario = @id_usuario AND activo = 1
    `, {
      id_usuario: { type: sql.Int, value: Number(id_usuario) },
      id_rol:     { type: sql.Int, value: targetRol },
    });

    if (!rows.length) return notFound(res);
    const accion = targetRol === 1 ? 'ascendido a Admin' : `cambiado a rol ${targetRol}`;
    console.log(`✅ Usuario ${id_usuario} ${accion}.`);
    ok(res, rows[0]);
  } catch (e) { fail(res, e); }
};

exports.listAdmins = async (_req, res) => {
  try {
    const rows = await queryP(`
      SELECT u.id_usuario, u.nombre, u.apellido, u.correo,
             u.tipo_usuario, u.matricula, u.num_empleado,
             u.id_rol, r.nombre_rol, u.foto_perfil
      FROM EDI.Usuarios u
      JOIN EDI.Roles r ON r.id_rol = u.id_rol
      WHERE u.activo = 1 AND r.nombre_rol = 'Admin'
      ORDER BY u.nombre
    `);
    ok(res, rows);
  } catch (e) { fail(res, e); }
};

exports.listRoles = async (_req, res) => {
  try {
    const rows = await queryP(
      `SELECT id_rol, nombre_rol FROM EDI.Roles ORDER BY id_rol`
    );
    ok(res, rows);
  } catch (e) { fail(res, e); }
};
