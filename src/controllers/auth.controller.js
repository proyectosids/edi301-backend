const { sql, queryP } = require('../dataBase/dbConnection');
const { comparePassword, hashPassword } = require('../utils/hash');
const { newSessionToken } = require('../utils/token');
const { ok, bad, fail } = require('../utils/http');
const UQ = require('../queries/usuarios.queries').Q;
const { loginSchema } = require('../models/auth.model');

// Límite de sesiones simultáneas por usuario.
// Cuando el usuario hace login en un (N+1)-ésimo dispositivo, se cierra
// automáticamente la sesión más antigua para mantener el límite.
const MAX_SESIONES_POR_USUARIO = 5;

exports.login = async (req, res) => {
  try {
    const { login, password, device_info, device_id, platform } = req.body || {};

    const { error, value } = loginSchema.validate({ login, password });
    if (error) return bad(res, 'Datos de inicio de sesión inválidos');

    const rows = await queryP(UQ.byLogin, { Login: { type: sql.NVarChar, value: value.login.trim() } });
    if (!rows.length) return bad(res, 'Usuario no encontrado');

    const user = rows[0];

    // Bloquear inicio de sesión a cuentas desactivadas (eliminadas por el usuario).
    if (user.activo === false || user.activo === 0) {
      return bad(res, 'Esta cuenta fue eliminada. Si lo deseas, puedes registrarte de nuevo con el mismo correo.');
    }

    const okPass = await comparePassword(password, user.contrasena);
    if (!okPass) return bad(res, 'Contraseña incorrecta');

    // Generar una sesión. Cuando el cliente identifica su dispositivo,
    // sustituimos únicamente su sesión anterior en vez de acumular filas.
    const token = newSessionToken();
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
                  .toString().split(',')[0].trim().slice(0, 45);

    const normalizedDeviceId = typeof device_id === 'string'
      ? device_id.trim().slice(0, 255)
      : '';

    if (normalizedDeviceId) {
      await queryP(UQ.deactivateSessionsForDevice, {
        id_usuario: { type: sql.Int, value: user.id_usuario },
        device_id:  { type: sql.NVarChar, value: normalizedDeviceId },
      });
    }

    await queryP(UQ.insertSession, {
      id_usuario:    { type: sql.Int,      value: user.id_usuario },
      session_token: { type: sql.NVarChar, value: token },
      fcm_token:     { type: sql.NVarChar, value: null },
      device_info:   { type: sql.NVarChar, value: (device_info || null) },
      device_id:     { type: sql.NVarChar, value: normalizedDeviceId || null },
      platform:      { type: sql.NVarChar, value: (platform    || null) },
      ip_address:    { type: sql.NVarChar, value: ip || null },
    });

    // Aplicar el límite de sesiones simultáneas: cierra las más antiguas
    // si el usuario ya superó el máximo permitido.
    await queryP(UQ.evictOldestSessions, {
      id_usuario: { type: sql.Int, value: user.id_usuario },
      keep:       { type: sql.Int, value: MAX_SESIONES_POR_USUARIO },
    });

    delete user.contrasena;
    user.session_token = token;
    ok(res, user);

  } catch (e) {
    console.error("Login Error:", e);
    fail(res, e);
  }
};


exports.logout = async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ','').trim();
    if (!token) return bad(res, 'Token requerido');
    // Marca como inactiva SOLO la sesión actual (otros dispositivos del mismo
    // usuario siguen vivos).
    await queryP(UQ.deactivateSessionByToken, {
      session_token: { type: sql.NVarChar, value: token },
    });
    ok(res, { message: 'Sesión cerrada' });
  } catch (e) { fail(res, e); }
};

exports.verificarCorreo = async (req, res) => {
  try {
    const { correo } = req.body;
    if (!correo) return bad(res, 'El correo es obligatorio');

    const rows = await queryP(
      `SELECT id_usuario FROM EDI.Usuarios WHERE correo = @correo`,
      { correo: { type: sql.NVarChar, value: correo } }
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'No existe una cuenta registrada con ese correo.' });
    }

    ok(res, { existe: true });
  } catch (e) {
    console.error('verificarCorreo error:', e);
    fail(res, e);
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { correo, nuevaContrasena } = req.body;
    
    if (!correo || !nuevaContrasena) {
      return bad(res, 'Faltan datos obligatorios');
    }

    const checkUser = await queryP(
      `SELECT id_usuario FROM EDI.Usuarios WHERE correo = @correo`, 
      { correo: { type: sql.NVarChar, value: correo } }
    );
    
    if (!checkUser.length) {
      return bad(res, 'No existe un usuario con ese correo');
    }

    const hashed = await hashPassword(nuevaContrasena);

    await queryP(`
      UPDATE EDI.Usuarios
      SET contrasena = @pass, updated_at = GETDATE()
      WHERE correo = @correo
    `, {
      pass: { type: sql.NVarChar, value: hashed },
      correo: { type: sql.NVarChar, value: correo }
    });

    ok(res, { message: 'Contraseña actualizada correctamente' });
  } catch (e) {
    console.error("Reset Password Error:", e);
    fail(res, e);
  }
};
