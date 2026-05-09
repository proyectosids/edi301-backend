// routes/renovaciones.routes.js
const express = require('express');
const router = express.Router();
const C = require('../controllers/renovaciones.controller');
const auth = require('../middleware/authGuard');

// Estado de la ventana (todos los autenticados)
router.get('/estado', auth, C.getEstadoVentana);

// Alumno solicita renovación
router.post('/solicitar', auth, C.solicitarRenovacion);

// Padre / tutor: ver pendientes y responder
router.get ('/mis-pendientes',                   auth, C.listMisPendientes);
router.get ('/familia/:id_familia/pendientes',   auth, C.listPendientesFamilia);
router.post('/:id_solicitud/responder',          auth, C.responderRenovacion);

// Admin
router.post('/admin/ventana', auth, C.setVentana);
router.get ('/admin',          auth, C.listAdmin);
router.post('/admin/vaciar',   auth, C.vaciarFamilias);

module.exports = router;
