const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}


async function saveOptimizedImage(file, { prefix = 'img', maxW = 1280, maxH = 1280, quality = 75 } = {}) {
  if (!file) return null;

  ensureUploadDir();

  const inputPath = file.tempFilePath;


  const fileName = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
  const outPath = path.join(UPLOAD_DIR, fileName);

  await sharp(inputPath)
    .rotate()
    .resize({
      width: maxW,
      height: maxH,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality })
    .toFile(outPath);


  try { fs.unlinkSync(inputPath); } catch (_) {}

  return `/uploads/${fileName}`;
}

async function saveOptimizedProfilePhoto(file, userId) {
  if (!file) return null;
  ensureUploadDir();

  // Forzamos formato .webp para ahorrar espacio y estandarizar
  const fileName = `perfil-${userId}-${Date.now()}.webp`;
  const outPath = path.join(UPLOAD_DIR, fileName);

  await sharp(file.tempFilePath || file.data)
    .rotate()
    .resize(512, 512, { fit: 'cover' }) // Tamaño estándar para perfiles
    .webp({ quality: 80 })
    .toFile(outPath);

  if (file.tempFilePath) {
    try { fs.unlinkSync(file.tempFilePath); } catch (_) {}
  }

  return `/uploads/${fileName}`;
}

module.exports = { saveOptimizedImage, saveOptimizedProfilePhoto };
