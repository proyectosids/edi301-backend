const router = require('express').Router();
const C = require('../controllers/configuracion.controller');
const auth = require('../middleware/authGuard');
const allow = require('../middleware/roleGuard');

router.get('/limite-hijos-edi', auth, allow('Admin'), C.getEdiChildLimit);
router.put('/limite-hijos-edi', auth, allow('Admin'), C.updateEdiChildLimit);

module.exports = router;
