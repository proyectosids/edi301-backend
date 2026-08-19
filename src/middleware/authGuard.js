const { sql, queryP } = require('../dataBase/dbConnection');
const UQ = require('../queries/usuarios.queries').Q;

// No hace falta escribir en SQL cada vez que la app consulta una pantalla.
// Conservamos actividad reciente con una escritura como máximo cada 5 minutos
// por sesión y evitamos saturar el pool.
const lastTouched = new Map();
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_SESSIONS = 10000;

function touchSessionOccasionally(idSesion) {
  const now = Date.now();
  const previous = lastTouched.get(idSesion) || 0;
  if (now - previous < TOUCH_INTERVAL_MS) return;

  lastTouched.set(idSesion, now);
  if (lastTouched.size > MAX_TRACKED_SESSIONS) {
    for (const [id, touchedAt] of lastTouched) {
      if (now - touchedAt > TOUCH_INTERVAL_MS) lastTouched.delete(id);
    }
  }

  queryP(UQ.touchSession, {
    id_sesion: { type: sql.Int, value: idSesion },
  }).catch(err => console.warn('touchSession failed:', err.message));
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
    touchSessionOccasionally(row.id_sesion);

    next();

  } catch (e) {
    console.error('authGuard error:', e);
    res.status(500).json({ error: 'Error de autenticación' });
  }
};
