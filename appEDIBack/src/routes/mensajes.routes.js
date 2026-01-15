const router = require('express').Router();
const C = require('../controllers/mensajes.controller');
const AuthMiddleware = require('../middleware/authGuard');
const authGuard = AuthMiddleware.authGuard || AuthMiddleware;

router.post('/', authGuard, C.create);
router.get('/familia/:id_familia', authGuard, C.listByFamilia);

module.exports = router;