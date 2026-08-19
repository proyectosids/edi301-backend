const { sql, queryP } = require('../dataBase/dbConnection');
const UQ = require('../queries/usuarios.queries').Q;
const SESSION_TOUCH_INTERVAL_MS = Number(process.env.SESSION_TOUCH_INTERVAL_MS || 5 * 60 * 1000);
const recentlyTouched = new Map();

function shouldTouchSession(idSession, databaseTimestamp) {
  const now = Date.now();
  const cachedAt = recentlyTouched.get(idSession) || 0;
  const storedAt = new Date(databaseTimestamp || 0).getTime() || 0;
  if (now - Math.max(cachedAt, storedAt) < SESSION_TOUCH_INTERVAL_MS) return false;
  recentlyTouched.set(idSession, now);

  if (recentlyTouched.size > 10000) {
    for (const [id, touchedAt] of recentlyTouched) {
      if (now - touchedAt > SESSION_TOUCH_INTERVAL_MS * 2) recentlyTouched.delete(id);
    }
  }
  return true;
}

module.exports = async function authGuard(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : null;

    if (!token) return res.status(401).json({ error: 'No autenticado' });

    // Buscar la sesión activa correspondiente al token en la tabla
    // EDI.Usuario_Sesiones (multi-dispositivo).
    const rs = await queryP(UQ.sessionByToken, {
      session_token: { type: sql.NVarChar, value: token },
    });

    if (!rs.length) {
      return res.status(401).json({ error: 'Token inválido o sesión expirada' });
    }

    const row = rs[0];

    // La cuenta del usuario debe seguir activa (no eliminada).
    if (row.usuario_activo === false || row.usuario_activo === 0) {
      return res.status(401).json({ error: 'La cuenta está inactiva' });
    }

    if (row.estado === 'Baja Temporal') {
      return res.status(403).json({ error: 'Acceso denegado: Baja Temporal' });
    }

    // Construir req.user con la misma forma que antes (compatibilidad con
    // controllers existentes que ya leen req.user.*).
    req.user = {
      id_usuario:    row.id_usuario,
      nombre:        row.nombre,
      apellido:      row.apellido,
      correo:        row.correo,
      tipo_usuario:  row.tipo_usuario,
      id_rol:        row.id_rol,
      foto_perfil:   row.foto_perfil,
      estado:        row.estado,
      session_token: row.session_token,
      nombre_rol:    row.nombre_rol,
    };

    // Información de la sesión actual: útil para "cerrar otras sesiones".
    req.session = {
      id_sesion:      row.id_sesion,
      device_info:    row.device_info,
      created_at:     row.sesion_created_at,
      last_active_at: row.last_active_at,
    };

    // Touch best-effort: refresca last_active_at para que la sesión no
    // sea evictada como "antigua" mientras se está usando.
    if (shouldTouchSession(row.id_sesion, row.last_active_at)) {
      queryP(UQ.touchSession, {
        id_sesion: { type: sql.Int, value: row.id_sesion },
      }).catch(err => {
        recentlyTouched.delete(row.id_sesion);
        console.warn('touchSession failed:', err.message);
      });
    }

    next();

  } catch (e) {
    console.error('authGuard error:', e);
    res.status(500).json({ error: 'Error de autenticación' });
  }
};
