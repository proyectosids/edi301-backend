const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, bad, fail } = require('../utils/http');
const { enviarNotificacionMulticast } = require('../utils/firebase');
const { insertarNotificacionesUsuariosActivos } = require('../utils/notificaciones');

/**
 * Crea el anuncio, registra el historial con una sola consulta y envia FCM
 * en lotes. Mantiene el contrato { enviados, fallidos, id_post }.
 */
exports.broadcast = async (req, res) => {
  try {
    const creadorId = req.user.id_usuario ?? req.user.id ?? req.user.userId;
    const { titulo, mensaje, tipo = 'ANUNCIO', emoji = '📢' } = req.body;

    if (!titulo || !mensaje) return bad(res, 'titulo y mensaje son requeridos');

    const tipoPost = tipo === 'EVENTO' ? 'EVENTO' : 'ANUNCIO';
    const pubRows = await queryP(
      `INSERT INTO EDI.Publicaciones
         (id_familia, id_usuario, categoria_post, mensaje, url_imagen, estado, tipo, activo, created_at)
       VALUES
         (NULL, @id_usuario, N'Institucional', @mensaje, NULL, 'Publicado', @tipo, 1, GETUTCDATE());
       SELECT CAST(SCOPE_IDENTITY() AS INT) AS id_post;`,
      {
        id_usuario: { type: sql.Int, value: creadorId },
        mensaje: { type: sql.NVarChar, value: `${emoji} ${titulo}\n\n${mensaje}` },
        tipo: { type: sql.NVarChar, value: tipoPost },
      }
    );
    const idPost = pubRows[0]?.id_post ?? null;
    const pushTitle = `${emoji} ${titulo}`;
    const pushBody = mensaje.length > 120 ? `${mensaje.substring(0, 117)}...` : mensaje;

    await insertarNotificacionesUsuariosActivos(pushTitle, pushBody, 'ALERTA', idPost);

    const tokenRows = await queryP(`
      SELECT s.fcm_token
      FROM EDI.Usuario_Sesiones s
      JOIN EDI.Usuarios u ON u.id_usuario = s.id_usuario
      WHERE u.activo = 1 AND s.activo = 1
        AND s.fcm_token IS NOT NULL AND LEN(s.fcm_token) > 10
    `);
    const pushResult = await enviarNotificacionMulticast(
      tokenRows.map(row => row.fcm_token),
      pushTitle,
      pushBody,
      { tipo: 'ALERTA', id_referencia: idPost ? idPost.toString() : '' }
    );

    req.io?.emit('alerta_broadcast', {
      titulo,
      mensaje,
      tipo: tipoPost,
      id_post: idPost,
      created_at: new Date().toISOString(),
    });

    ok(res, {
      enviados: pushResult.successCount,
      fallidos: pushResult.failureCount,
      id_post: idPost,
    });
  } catch (e) {
    console.error('[broadcast] error general:', e);
    fail(res, e);
  }
};
