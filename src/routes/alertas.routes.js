const router = require('express').Router();
const C = require('../controllers/alertas.controller');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');

const ROLES_ADMIN = ['Admin'];

// POST /api/alertas/broadcast  – solo admins
router.post('/broadcast', authGuard, roleGuard(...ROLES_ADMIN), C.broadcast);

module.exports = router;
