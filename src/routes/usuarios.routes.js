const express = require('express');
const router = express.Router();
const C = require('../controllers/usuarios.controller');
const F = require('../controllers/familias.controller');
const validate = require('../utils/validate');
const { createUserSchema, updateUserSchema } = require('../models/usuario.model');
const auth = require('../middleware/authGuard')
const { saveOptimizedImage } = require('../utils/imageStorage')

//router.get('/', C.list);
router.get('/', C.searchUsers);
router.get('/familias/by-doc/search', F.searchByDocument);
router.put('/update-token', C.updateToken);
// Rutas específicas ANTES de /:id para evitar conflictos
router.get('/cumpleanos',         C.getBirthdays);
router.get('/cumpleanos/imagen',   C.getImagenCumpleanos);
router.put('/cumpleanos/imagen',   auth, C.setImagenCumpleanos);
router.post('/cumpleanos/imagen',  auth, async (req, res) => {
  try {
    if (!req.files || !req.files.imagen) {
      return res.status(400).json({ error: 'Se requiere el campo "imagen"' });
    }
    const file = req.files.imagen;
    const url = await saveOptimizedImage(file, {
      prefix: 'cumpleanos',
      folder: 'edi301/cumpleanos',
      maxW: 1200,
      maxH: 800,
      quality: 80,
    });
    const { setImagenCumpleanos } = require('../services/birthday.service');
    setImagenCumpleanos(url);
    res.json({ ok: true, url, imagen: url });
  } catch (e) {
    console.error('Error subiendo imagen cumpleaños:', e);
    res.status(500).json({ error: e.message });
  }
});

// Rutas con parámetro dinámico AL FINAL
router.get('/:id', auth, C.get);
router.post('/', validate(createUserSchema), C.create);
router.put('/:id', validate(updateUserSchema), C.update);
router.delete('/:id', C.remove);
router.patch('/:id/email', C.updateEmail);

module.exports = router;