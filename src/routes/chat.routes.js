const router = require('express').Router();
const C = require('../controllers/chat.controller');
const auth = require('../middleware/authGuard');

// Iniciar chat privado 
router.post('/private', auth, C.initPrivateChat);

// Crear grupo 
router.post('/group', auth, C.createGroup);

// Enviar mensaje
router.post('/message', auth, C.sendMessage);

// Ver mis conversaciones
router.get('/', auth, C.getMyChats);

// Total de mensajes no leídos (para badge del menú)
router.get('/unread-total', auth, C.totalUnread);

// Marcar sala como leída
router.patch('/:id_sala/leer', auth, C.markRead);

// Ver mensajes de una sala específica
router.get('/:id_sala/messages', auth, C.getMessages);

module.exports = router;