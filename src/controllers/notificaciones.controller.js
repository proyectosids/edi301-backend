const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, bad, notFound, fail } = require('../utils/http');

// GET /api/notificaciones  → lista todas las notificaciones del usuario autenticado
exports.list = async (req, res) => {
  try {
    const idUsuario = req.user.id_usuario;
    const rows = await queryP(`
      SELECT id, id_usuario_destino, titulo, cuerpo, tipo,
             id_referencia, leido, fecha_creacion
      FROM EDI.Notificaciones
      WHERE id_usuario_destino = @uid
      ORDER BY fecha_creacion DESC
    `, { uid: { type: sql.Int, value: idUsuario } });

    ok(res, rows);
  } catch (e) { fail(res, e); }
};

// GET /api/notificaciones/no-leidas  → cantidad de notificaciones no leídas
exports.unreadCount = async (req, res) => {
  try {
    const idUsuario = req.user.id_usuario;
    const rows = await queryP(`
      SELECT COUNT(*) AS total
      FROM EDI.Notificaciones
      WHERE id_usuario_destino = @uid AND leido = 0
    `, { uid: { type: sql.Int, value: idUsuario } });

    ok(res, { total: rows[0]?.total ?? 0 });
  } catch (e) { fail(res, e); }
};

// PATCH /api/notificaciones/:id/leer  → marca una notificación como leída
exports.markRead = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const idUsuario = req.user.id_usuario;

    const check = await queryP(
      `SELECT id FROM EDI.Notificaciones WHERE id = @id AND id_usuario_destino = @uid`,
      { id: { type: sql.Int, value: id }, uid: { type: sql.Int, value: idUsuario } }
    );
    if (!check.length) return notFound(res);

    await queryP(
      `UPDATE EDI.Notificaciones SET leido = 1 WHERE id = @id AND id_usuario_destino = @uid`,
      { id: { type: sql.Int, value: id }, uid: { type: sql.Int, value: idUsuario } }
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
};

// PATCH /api/notificaciones/leer-todas  → marca todas como leídas
exports.markAllRead = async (req, res) => {
  try {
    const idUsuario = req.user.id_usuario;
    await queryP(
      `UPDATE EDI.Notificaciones SET leido = 1 WHERE id_usuario_destino = @uid AND leido = 0`,
      { uid: { type: sql.Int, value: idUsuario } }
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
};

// DELETE /api/notificaciones/:id  → elimina una notificación
exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const idUsuario = req.user.id_usuario;

    const check = await queryP(
      `SELECT id FROM EDI.Notificaciones WHERE id = @id AND id_usuario_destino = @uid`,
      { id: { type: sql.Int, value: id }, uid: { type: sql.Int, value: idUsuario } }
    );
    if (!check.length) return notFound(res);

    await queryP(
      `DELETE FROM EDI.Notificaciones WHERE id = @id AND id_usuario_destino = @uid`,
      { id: { type: sql.Int, value: id }, uid: { type: sql.Int, value: idUsuario } }
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
};

// DELETE /api/notificaciones/todas  → elimina todas las notificaciones del usuario
exports.removeAll = async (req, res) => {
  try {
    const idUsuario = req.user.id_usuario;
    await queryP(
      `DELETE FROM EDI.Notificaciones WHERE id_usuario_destino = @uid`,
      { uid: { type: sql.Int, value: idUsuario } }
    );
    ok(res, { ok: true });
  } catch (e) { fail(res, e); }
};
