const router = require('express').Router();
const C = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimits');

router.post('/login', authLimiter, C.login);
router.post('/logout', C.logout);
router.post('/verificar-correo', authLimiter, C.verificarCorreo);
router.post('/reset-password', authLimiter, C.resetPassword);

module.exports = router;
