const router = require('express').Router();
const C = require('../controllers/encuestas.controller');
const auth = require('../middleware/authGuard');
const allow = require('../middleware/roleGuard');
const validate = require('../utils/validate');
const M = require('../models/encuesta.model');

router.get('/', auth, C.list);
router.get('/:id', auth, C.get);
router.post('/', auth, allow('Admin'), validate(M.createEncuesta), C.create);
router.put('/:id', auth, allow('Admin'), validate(M.updateEncuesta), C.update);
router.patch('/:id/cerrar', auth, allow('Admin'), C.close);
router.delete('/:id', auth, allow('Admin'), C.remove);
router.post('/:id/respuestas', auth, validate(M.submitRespuesta), C.submit);
router.get('/:id/resultados', auth, allow('Admin'), C.results);
module.exports = router;
