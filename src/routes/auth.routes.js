const router = require('express').Router();
const C = require('../controllers/auth.controller');
const loginRateLimit = require('../middleware/loginRateLimit');

router.post('/login', loginRateLimit, C.login);
router.post('/logout', C.logout);
router.post('/verificar-correo', C.verificarCorreo);
router.post('/reset-password', C.resetPassword);

module.exports = router;
