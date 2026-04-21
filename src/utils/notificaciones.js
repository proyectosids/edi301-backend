/**
 * Utilidad para insertar filas en EDI.Notificaciones.
 * Esto alimenta el historial de notificaciones en la app (página de campana).
 */
const { sql, queryP } = require('../dataBase/dbConnection');

/**
 * Inserta una notificación en la tabla EDI.Notificaciones.
 * @param {number}  idDestino   - id_usuario receptor
 * @param {string}  titulo
 * @param {string}  cuerpo
 * @param {string}  tipo        - e.g. 'CUMPLEANOS', 'MENSAJE', 'LIKE', 'COMENTARIO', etc.
 * @param {number|null} idRef   - id de referencia (post, sala, etc.)
 */
async function insertarNotificacion(idDestino, titulo, cuerpo, tipo, idRef = null) {
  try {
    await queryP(`
      INSERT INTO EDI.Notificaciones
        (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
      VALUES
        (@dest, @titulo, @cuerpo, @tipo, @ref, 0, GETUTCDATE())
    `, {
      dest:   { type: sql.Int,      value: idDestino },
      titulo: { type: sql.NVarChar, value: titulo },
      cuerpo: { type: sql.NVarChar, value: cuerpo },
      tipo:   { type: sql.NVarChar, value: tipo },
      ref:    { type: sql.Int,      value: idRef },
    });
  } catch (err) {
    // No lanzar — las notificaciones nunca deben romper el flujo principal
    console.error(`[notif] Error insertando notificación tipo=${tipo}:`, err?.message);
  }
}

module.exports = { insertarNotificacion };
