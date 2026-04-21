const router = require('express').Router();
const C = require('../controllers/hijos-hogar.controller');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

const ROLES_ADMIN = ['Admin'];

router.get('/familia/:id_familia', authGuard, C.listByFamilia);
router.post('/',                   authGuard, roleGuard(...ROLES_ADMIN), C.create);
router.delete('/:id',              authGuard, roleGuard(...ROLES_ADMIN), C.remove);

module.exports = router;
