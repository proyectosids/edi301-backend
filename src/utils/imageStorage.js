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

module.exports = { saveOptimizedImage };
