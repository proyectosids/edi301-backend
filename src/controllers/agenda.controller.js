const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { Q } = require('../queries/agenda.queries');
const { enviarNotificacionPush } = require('../utils/firebase');
const { saveOptimizedImage } = require('../utils/imageStorage');

exports.create = async (req, res) => {
  try {
    const { titulo, descripcion, fecha_evento, hora_evento, estado_publicacion, dias_anticipacion } = req.body;

    if (!titulo || !fecha_evento) return bad(res, 'titulo y fecha_evento requeridos');

    let imagenUrl = null;
    if (req.files && req.files.imagen) {
      try {
        imagenUrl = await saveOptimizedImage(req.files.imagen, {
          prefix: 'evento',
          maxW: 1280,
          maxH: 1280,
          quality: 75,
          folder: 'edi301/eventos',
        });
      } catch (imgErr) {
        return bad(res, imgErr.message || 'Error procesando imagen');
      }
    }

    const rows = await queryP(Q.create, {
      titulo:             { type: sql.NVarChar, value: titulo },
      descripcion:        { type: sql.NVarChar, value: descripcion ?? null },
      fecha_evento:       { type: sql.Date, value: fecha_evento },
      hora_evento:        { type: sql.NVarChar, value: hora_evento ?? null },
      imagen:             { type: sql.NVarChar, value: imagenUrl },
      estado_publicacion: { type: sql.NVarChar, value: estado_publicacion ?? 'Publicada' },
      dias_anticipacion:  { type: sql.Int, value: dias_anticipacion || 3 },
    });

    created(res, rows[0]);

    req.io?.to('institucional').emit('evento_creado', rows[0]);
    req.io?.emit('feed_actualizado', { source: 'agenda', id_actividad: rows[0].id_actividad });

    (async () => {
      try {
        const usuarios = await queryP(
          'SELECT fcm_token FROM EDI.Usuarios WHERE fcm_token IS NOT NULL AND activo = 1'
        );
        if (usuarios && usuarios.length > 0) {
          for (const u of usuarios) {
            await enviarNotificacionPush(
              u.fcm_token,
              '📅 Nuevo Evento',
              `${titulo}`,
              { tipo: 'EVENTO', id_referencia: rows[0].id_actividad.toString() }
            );
          }
        }
      } catch (e) {
        console.error('Error notificaciones:', e);
      }
    })();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, e);
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { titulo, descripcion, fecha_evento, hora_evento, estado_publicacion, dias_anticipacion } = req.body;

    let imagenUrl = undefined;
    if (req.files && req.files.imagen) {
      try {
        imagenUrl = await saveOptimizedImage(req.files.imagen, {
          prefix: 'evento',
          maxW: 1280,
          maxH: 1280,
          quality: 75,
          folder: 'edi301/eventos',
        });
      } catch (imgErr) {
        return bad(res, imgErr.message || 'Error procesando imagen');
      }
    }

    const params = {
      id_actividad:       { type: sql.Int, value: id },
      titulo:             { type: sql.NVarChar, value: titulo },
      descripcion:        { type: sql.NVarChar, value: descripcion },
      fecha_evento:       { type: sql.Date, value: fecha_evento },
      hora_evento:        { type: sql.NVarChar, value: hora_evento ?? null },
      estado_publicacion: { type: sql.NVarChar, value: estado_publicacion ?? null },
      dias_anticipacion:  { type: sql.Int, value: dias_anticipacion ?? null },
    };

    if (imagenUrl !== undefined) {
      params.imagen = { type: sql.NVarChar, value: imagenUrl };
    }

    const rows = await queryP(Q.update, params);
    if (!rows || !rows.length) return notFound(res, 'No se pudo actualizar');

    ok(res, rows[0]);
    req.io?.to('institucional').emit('evento_actualizado', rows[0]);
    req.io?.emit('feed_actualizado', { source: 'agenda', id_actividad: rows[0].id_actividad });
  } catch (e) {
    console.error(e);
    fail(res, e);
  }
};

exports.list = async (req, res) => {
  try {
    const { estado, desde, hasta } = req.query;
    ok(res, await queryP(Q.list, {
      estado: { type: sql.NVarChar, value: estado ?? null },
      desde:  { type: sql.Date, value: desde ?? null },
      hasta:  { type: sql.Date, value: hasta ?? null },
    }));
  } catch (e) { fail(res, e); }
};

exports.remove = async (req, res) => {
  try {
    await queryP(Q.remove, {
      id_actividad: { type: sql.Int, value: Number(req.params.id) },
    });
    ok(res, { message: 'Evento eliminado' });

    const id_actividad = Number(req.params.id);
    req.io?.to('institucional').emit('evento_eliminado', { id_actividad });
    req.io?.emit('feed_actualizado', { source: 'agenda', id_actividad });
  } catch (e) { fail(res, e); }
};
