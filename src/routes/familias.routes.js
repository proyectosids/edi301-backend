const router = require('express').Router();
const C = require('../controllers/familias.controller');
const validate = require('../utils/validate');
const {
  createFamilia,
  updateFamilia,
  createFamiliaManual,
  linkUserToFamily,
} = require('../models/familia.model');
const auth = require('../middleware/authGuard');
const allow = require('../middleware/roleGuard');

// Crear / actualizar / borrar (solo Admin)
router.post('/',  auth, allow('Admin'), validate(createFamilia), C.create);

// ── Familia manual (sólo Admin) ─────────────────────────────────────────────
// Permite crear una familia ingresando los nombres de los padres a mano,
// sin que estén registrados todavía. Genera nombre_familia con la misma
// fórmula que el módulo principal.
router.post('/manual', auth, allow('Admin'), validate(createFamiliaManual), C.createManual);

// ── Familias con padres pendientes (panel Admin) ────────────────────────────
router.get('/pendientes', auth, allow('Admin'), C.listPendientes);

// ── Candidatos para un usuario (modal post-registro / panel admin) ─────────
// Devuelve familias activas con slot PAPA/MAMA pendiente cuyo
// nombre+apellido coincida con el del usuario.
router.get('/candidatos/:id_usuario', auth, C.findCandidatesForUser);

// ── Vincular usuario a una familia pendiente ────────────────────────────────
// El usuario puede vincularse a sí mismo (modal "elige tu familia") o un
// Admin puede vincular a un tercero (panel). La autorización fina vive
// dentro del controller.
router.post('/:id/vincular', auth, validate(linkUserToFamily), C.linkUser);

router.put('/:id', auth, allow('Admin'), validate(updateFamilia), C.update);
router.delete('/:id/permanent', auth, allow('Admin'), C.permanentDelete);
router.delete('/:id', auth, allow('Admin'), C.remove);

router.patch('/:id/fotos',
  auth,
  allow('Admin', 'PapaEDI', 'MamaEDI'),
  C.uploadFotos
);

router.patch('/:id/descripcion',
  auth,
  allow('Admin', 'PapaEDI', 'MamaEDI'),
  C.updateDescripcion
);

// Reactivar
router.patch('/:id/reactivar', auth, allow('Admin'), C.reactivate);

// Lectura
router.get('/search', C.searchByName);
router.get('/por-ident/:ident', C.byIdent);
router.get('/reporte-completo', auth, allow('Admin'), C.reporteCompleto);
router.get('/inactivas', auth, allow('Admin'), C.listInactive);
router.get('/', C.list);
router.get('/available', C.listAvailable);
router.get('/:id', C.get);

module.exports = router;
