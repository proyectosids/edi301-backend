const router = require('express').Router();
const C = require('../controllers/mensajes.controller');
// 👇 CORRECCIÓN SEGURA PARA AUTHGUARD
const AuthMiddleware = require('../middleware/authGuard');
const authGuard = AuthMiddleware.authGuard || AuthMiddleware;

// Rutas
router.post('/', authGuard, C.create);
router.get('/familia/:id_familia/no-leidos', authGuard, C.unreadCount);
router.get('/familia/:id_familia', authGuard, C.listByFamilia);

module.exports = router;