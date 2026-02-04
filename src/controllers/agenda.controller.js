const { sql, queryP } = require('../dataBase/dbConnection');
const { ok, created, bad, notFound, fail } = require('../utils/http');
const { Q } = require('../queries/agenda.queries');
const { enviarNotificacionPush } = require('../utils/firebase');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

const ensureUploadDir = () => {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
};

const isImageFile = (file) => {
  if (!file) return false;

  const mime = (file.mimetype || '').toLowerCase();
  const ext = path.extname(file.name || '').toLowerCase();

  const mimeOk = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(mime);
  const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
  if (mime === 'application/octet-stream' && extOk) return true;

  return mimeOk || extOk;
};



const saveOptimizedImage = async (file) => {
  if (!file) return null;
  if (!isImageFile(file)) {
  throw new Error('Archivo no permitido. Solo se aceptan imágenes (jpg, jpeg, png, webp).');
}
  const MAX_BYTES = 5 * 1024 * 1024;
  if (file.size && file.size > MAX_BYTES) {
    throw new Error('Imagen demasiado grande. Máximo 5MB.');
  }

  ensureUploadDir();
  const fileName = `evento-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const outPath = path.join(UPLOAD_DIR, fileName);

  if (file.tempFilePath) {
    await sharp(file.tempFilePath)
      .rotate()
      .resize({
        width: 1280,   
        height: 1280,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 75 })
      .toFile(outPath);

    try { fs.unlinkSync(file.tempFilePath); } catch (_) {}
  } else {

    await sharp(file.data)
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 75 })
      .toFile(outPath);
  }

  return `/uploads/${fileName}`;
};

exports.create = async (req, res) => {
  try {
    const { titulo, descripcion, fecha_evento, hora_evento, estado_publicacion, dias_anticipacion } = req.body;

    if (!titulo || !fecha_evento) return bad(res, 'titulo y fecha_evento requeridos');

    let imagenUrl = null;
    if (req.files && req.files.imagen) {
  const f = req.files.imagen;
  console.log('IMG name:', f.name);
  console.log('IMG mimetype:', f.mimetype);
  console.log('IMG size:', f.size);
}

    if (req.files && req.files.imagen) {
      try {
        imagenUrl = await saveOptimizedImage(req.files.imagen);
      } catch (imgErr) {
        return bad(res, imgErr.message || 'Error procesando imagen');
      }
    }

    const rows = await queryP(Q.create, {
      titulo:             { type: sql.NVarChar, value: titulo },
      descripcion:        { type: sql.NVarChar, value: descripcion ?? null },
      fecha_evento:       { type: sql.Date,     value: fecha_evento },
      hora_evento:        { type: sql.NVarChar, value: hora_evento ?? null },
      imagen:             { type: sql.NVarChar, value: imagenUrl },
      estado_publicacion: { type: sql.NVarChar, value: estado_publicacion ?? 'Publicada' },
      dias_anticipacion:  { type: sql.Int,      value: dias_anticipacion || 3 }
    });

    created(res, rows[0]);

    // Notificaciones
    (async () => {
      try {
        const usuarios = await queryP(
          "SELECT fcm_token FROM EDI.Usuarios WHERE fcm_token IS NOT NULL AND activo = 1"
        );
        if (usuarios && usuarios.length > 0) {
          for (const u of usuarios) {
            await enviarNotificacionPush(
              u.fcm_token,
              "📅 Nuevo Evento",
              `${titulo}`,
              { tipo: 'EVENTO', id_referencia: rows[0].id_actividad.toString() }
            );
          }
        }
      } catch (e) {
        console.error("Error notificaciones:", e);
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
        imagenUrl = await saveOptimizedImage(req.files.imagen);
      } catch (imgErr) {
        return bad(res, imgErr.message || 'Error procesando imagen');
      }
    }

    const params = {
      id_actividad:       { type: sql.Int,      value: id },
      titulo:             { type: sql.NVarChar, value: titulo },
      descripcion:        { type: sql.NVarChar, value: descripcion },
      fecha_evento:       { type: sql.Date,     value: fecha_evento },
      hora_evento:        { type: sql.NVarChar, value: hora_evento ?? null },
      estado_publicacion: { type: sql.NVarChar, value: estado_publicacion ?? null },
      dias_anticipacion:  { type: sql.Int,      value: dias_anticipacion ?? null }
    };


    if (imagenUrl !== undefined) {
      params.imagen = { type: sql.NVarChar, value: imagenUrl };
    }

    const rows = await queryP(Q.update, params);

    if (!rows || !rows.length) return notFound(res, 'No se pudo actualizar');
    ok(res, rows[0]);

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
      desde:  { type: sql.Date,     value: desde ?? null },
      hasta:  { type: sql.Date,     value: hasta ?? null }
    }));
  } catch (e) { fail(res, e); }
};

exports.remove = async (req, res) => {
  try {
    await queryP(Q.remove, {
      id_actividad: { type: sql.Int, value: Number(req.params.id) }
    });
    ok(res, { message: 'Evento eliminado' });
  } catch (e) { fail(res, e); }
};
