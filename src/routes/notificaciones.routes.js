const router = require('express').Router();
const C = require('../controllers/notificaciones.controller');
const auth = require('../middleware/authGuard');

// Rutas específicas ANTES de /:id para evitar conflictos de orden
router.get('/no-leidas',         auth, C.unreadCount);
router.patch('/leer-todas',      auth, C.markAllRead);
router.delete('/todas',          auth, C.removeAll);

// Rutas con parámetro
router.get('/',                  auth, C.list);
router.patch('/:id/leer',        auth, C.markRead);
router.delete('/:id',            auth, C.remove);

module.exports = router;
