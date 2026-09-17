const router = require('express').Router();
const C = require('../controllers/poblacion.controller');
const auth = require('../middleware/authGuard');
const allow = require('../middleware/roleGuard');

// Conteo de usuarios de la app, para estudios y muestreo. Solo Admin: es un
// censo de la poblacion, no informacion que cada usuario deba ver.
router.get('/', auth, allow('Admin'), C.resumen);

module.exports = router;
