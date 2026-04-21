const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, fail } = require('../utils/http');
const { enviarNotificacionPush } = require('../utils/firebase');
const { insertarNotificacion } = require('../utils/notificaciones');

/**
 * POST /api/alertas/broadcast
 *
 * Body:
 *   tipo     : 'ANUNCIO' | 'PUBLICACION' | 'EVENTO'
 *   titulo   : string  (required)
 *   mensaje  : string  (required)
 *   emoji    : string  (optional – prepended to push title)
 *
 * Behaviour:
 *   1. Inserts an institutional Publicacion (tipo=ANUNCIO) so it shows in the feed.
 *   2. Inserts an EDI.Notificaciones row for every active user.
 *   3. Sends an FCM push to every user that has an fcm_token.
 *   4. Emits a socket event so connected clients update in real-time.
 *
 * Returns { enviados: N, fallidos: M }
 */
exports.broadcast = async (req, res) => {
  try {
    const creadorId = req.user.id_usuario ?? req.user.id ?? req.user.userId;
    const { titulo, mensaje, tipo = 'ANUNCIO', emoji = '📢' } = req.body;

    if (!titulo || !mensaje) return bad(res, 'titulo y mensaje son requeridos');

    // ── 1. Crear publicación institucional en el feed ─────────────────────
    const tipoPost = tipo === 'EVENTO' ? 'EVENTO' : 'ANUNCIO';
    const pubRows = await queryP(
      `INSERT INTO EDI.Publicaciones
         (id_familia, id_usuario, categoria_post, mensaje, url_imagen, estado, tipo, activo, created_at)
       VALUES
         (NULL, @id_usuario, N'Institucional', @mensaje, NULL, 'Publicado', @tipo, 1, GETUTCDATE());
       SELECT CAST(SCOPE_IDENTITY() AS INT) AS id_post;`,
      {
        id_usuario: { type: sql.Int,      value: creadorId },
        mensaje:    { type: sql.NVarChar, value: `${emoji} ${titulo}\n\n${mensaje}` },
        tipo:       { type: sql.NVarChar, value: tipoPost },
      }
    );
    const idPost = pubRows[0]?.id_post ?? null;

    // ── 2. Obtener todos los usuarios activos ─────────────────────────────
    const usuarios = await queryP(
      `SELECT id_usuario, fcm_token
       FROM EDI.Usuarios
       WHERE activo = 1`
    );

    let enviados = 0;
    let fallidos = 0;

    // ── 3. Insertar notificación + push para cada usuario ─────────────────
    const pushTitle  = `${emoji} ${titulo}`;
    const pushBody   = mensaje.length > 120 ? mensaje.substring(0, 117) + '...' : mensaje;

    await Promise.all(
      usuarios.map(async (u) => {
        try {
          // historial de notificaciones (campana)
          await insertarNotificacion(
            u.id_usuario,
            pushTitle,
            pushBody,
            'ALERTA',
            idPost
          );

          // push FCM
          if (u.fcm_token) {
            await enviarNotificacionPush(
              u.fcm_token,
              pushTitle,
              pushBody,
              { tipo: 'ALERTA', id_referencia: idPost ? idPost.toString() : '' }
            );
          }
          enviados++;
        } catch (e) {
          console.error(`[broadcast] error usuario ${u.id_usuario}:`, e?.message);
          fallidos++;
        }
      })
    );

    // ── 4. Socket: todos los clientes actualizan el feed ─────────────────
    req.io?.emit('alerta_broadcast', {
      titulo,
      mensaje,
      tipo: tipoPost,
      id_post: idPost,
      created_at: new Date().toISOString(),
    });

    ok(res, { enviados, fallidos, id_post: idPost });
  } catch (e) {
    console.error('[broadcast] error general:', e);
    fail(res, e);
  }
};
