const fs = require('fs');
const sharp = require('sharp');
const streamifier = require('streamifier');
const cloudinary = require('./cloudinaryStorage');

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',           // iOS / Android cámaras modernas
  'image/bmp', 'image/tiff',            // otros formatos comunes
  'application/octet-stream',           // algunos clientes no detectan el tipo
];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif'];
const MAX_BYTES = 5 * 1024 * 1024;

function isImageFile(file) {
  if (!file) return false;

  const mime = String(file.mimetype || '').toLowerCase();
  const rawName = String(file.name || '');
  const ext = rawName.includes('.') ? `.${rawName.split('.').pop().toLowerCase()}` : '';

  const mimeOk = ALLOWED_MIME_TYPES.includes(mime);
  const extOk = ALLOWED_EXTENSIONS.includes(ext);

  // Acepta si el MIME está permitido O si la extensión está permitida.
  // Si no hay ni MIME ni extensión reconocible, deja que sharp intente procesarlo.
  return mimeOk || extOk || mime === '';
}

async function getInputBuffer(file) {
  if (!file) return null;

  if (file.tempFilePath) {
    const buffer = await fs.promises.readFile(file.tempFilePath);
    try { fs.unlinkSync(file.tempFilePath); } catch (_) {}
    return buffer;
  }

  return file.data || null;
}

function uploadBufferToCloudinary(buffer, { folder = 'edi301/general', publicId, resourceType = 'image' } = {}) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
        overwrite: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

function validateImageFile(file) {
  if (!file) return;

  if (!isImageFile(file)) {
    throw new Error('Archivo no permitido. Solo se aceptan imágenes (jpg, jpeg, png, webp).');
  }

  if (file.size && file.size > MAX_BYTES) {
    throw new Error('Imagen demasiado grande. Máximo 5MB.');
  }
}

async function saveOptimizedImage(
  file,
  { prefix = 'img', maxW = 1280, maxH = 1280, quality = 75, folder = 'edi301/general', fit = 'inside' } = {}
) {
  if (!file) return null;

  validateImageFile(file);

  const inputBuffer = await getInputBuffer(file);
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: maxW,
      height: maxH,
      fit,
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();

  const publicId = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;

  const result = await uploadBufferToCloudinary(outputBuffer, {
    folder,
    publicId,
    resourceType: 'image',
  });

  return result.secure_url;
}

async function saveOptimizedProfilePhoto(file, userId) {
  if (!file) return null;

  validateImageFile(file);

  const inputBuffer = await getInputBuffer(file);
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(512, 512, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();

  const result = await uploadBufferToCloudinary(outputBuffer, {
    folder: 'edi301/profiles',
    publicId: `perfil-${userId}-${Date.now()}`,
    resourceType: 'image',
  });

  return result.secure_url;
}

module.exports = {
  isImageFile,
  validateImageFile,
  saveOptimizedImage,
  saveOptimizedProfilePhoto,
};
