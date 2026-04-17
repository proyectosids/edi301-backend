const router = require('express').Router();
const C = require('../controllers/auth.controller');

router.post('/login', C.login);
router.post('/logout', C.logout);
router.post('/verificar-correo', C.verificarCorreo);
router.post('/reset-password', C.resetPassword);

module.exports = router;
