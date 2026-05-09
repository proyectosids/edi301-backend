// ============================================================================
// utils/sessions.js
//
// Helpers para trabajar con sesiones multi-dispositivo (EDI.Usuario_Sesiones).
// Sirven para hacer fan-out de notificaciones push a TODOS los dispositivos
// activos de un usuario o conjunto de usuarios.
// ============================================================================
const { sql, queryP } = require('../dataBase/dbConnection');

/**
 * Obtiene los fcm_tokens activos de un conjunto de usuarios.
 *
 * @param {number[]} idsUsuarios  IDs de los usuarios a expandir.
 * @returns {Promise<string[]>}   Lista de fcm_tokens (puede haber varios por
 *                                usuario si tiene varios dispositivos).
 *                                Sin duplicados.
 */
async function getActiveFcmTokensForUsers(idsUsuarios) {
  if (!Array.isArray(idsUsuarios) || idsUsuarios.length === 0) return [];

  // Limpiamos a ints válidos para evitar inyección, ya que vamos a inlinearlos
  // en la query (mssql no acepta arrays como parámetros TVP sin más setup).
  const ids = idsUsuarios
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];

  const rows = await queryP(`
    SELECT s.fcm_token
    FROM EDI.Usuario_Sesiones s
    JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
    WHERE s.id_usuario IN (${ids.join(',')})
      AND s.activo = 1
      AND u.activo = 1
      AND s.fcm_token IS NOT NULL
      AND LEN(s.fcm_token) > 10
  `);

  // Deduplicar (un mismo fcm_token podría existir en varias filas si fue
  // copiado entre sesiones por el cliente).
  return [...new Set(rows.map(r => r.fcm_token).filter(Boolean))];
}

/**
 * Atajo: para un solo id_usuario, devuelve todos sus fcm_tokens activos.
 */
async function getActiveFcmTokensForUser(idUsuario) {
  return getActiveFcmTokensForUsers([idUsuario]);
}

module.exports = {
  getActiveFcmTokensForUsers,
  getActiveFcmTokensForUser,
};
