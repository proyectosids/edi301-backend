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

function normalizarIds(idsUsuarios) {
  return [...new Set((idsUsuarios || [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0))];
}

async function insertarNotificaciones(idsUsuarios, titulo, cuerpo, tipo, idRef = null) {
  const ids = normalizarIds(idsUsuarios);
  if (!ids.length) return 0;

  try {
    const rows = await queryP(`
      INSERT INTO EDI.Notificaciones
        (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
      SELECT u.id_usuario, @titulo, @cuerpo, @tipo, @ref, 0, GETUTCDATE()
      FROM EDI.Usuarios u
      WHERE u.id_usuario IN (${ids.join(',')});

      SELECT @@ROWCOUNT AS total;
    `, {
      titulo: { type: sql.NVarChar, value: titulo },
      cuerpo: { type: sql.NVarChar, value: cuerpo },
      tipo:   { type: sql.NVarChar, value: tipo },
      ref:    { type: sql.Int,      value: idRef },
    });

    return Number(rows[0]?.total || 0);
  } catch (error) {
    console.error(`[notif] Error insertando lote tipo=${tipo}:`, error?.message);
    return 0;
  }
}

async function insertarNotificacionesUsuariosActivos(titulo, cuerpo, tipo, idRef = null) {
  try {
    const rows = await queryP(`
      INSERT INTO EDI.Notificaciones
        (id_usuario_destino, titulo, cuerpo, tipo, id_referencia, leido, fecha_creacion)
      SELECT u.id_usuario, @titulo, @cuerpo, @tipo, @ref, 0, GETUTCDATE()
      FROM EDI.Usuarios u
      WHERE u.activo = 1;

      SELECT @@ROWCOUNT AS total;
    `, {
      titulo: { type: sql.NVarChar, value: titulo },
      cuerpo: { type: sql.NVarChar, value: cuerpo },
      tipo:   { type: sql.NVarChar, value: tipo },
      ref:    { type: sql.Int,      value: idRef },
    });

    return Number(rows[0]?.total || 0);
  } catch (error) {
    console.error(`[notif] Error insertando broadcast tipo=${tipo}:`, error?.message);
    return 0;
  }
}

module.exports = {
  insertarNotificacion,
  insertarNotificaciones,
  insertarNotificacionesUsuariosActivos,
};
