const Joi = require('joi');

const residenciaEnum = Joi.string().valid('INTERNA', 'EXTERNA');

exports.createFamilia = Joi.object({
  nombre_familia: Joi.string().max(100).required(),
  residencia: residenciaEnum.required(),
  direccion: Joi.when('residencia', {
    is: 'EXTERNA',
    then: Joi.string().trim().min(5).max(255).required(),
    otherwise: Joi.string().allow(null, '').optional(),
  }),
  papa_id: Joi.number().integer().allow(null),
  mama_id: Joi.number().integer().allow(null),
  hijos: Joi.array().items(Joi.number().integer()).optional(),
  tios: Joi.array().items(Joi.number().integer()).optional(),
  descripcion: Joi.string().max(500).allow(null, ''),
}).options({ stripUnknown: true });

exports.updateFamilia = Joi.object({
  nombre_familia: Joi.string().max(100),
  residencia: residenciaEnum,
  direccion: Joi.when('residencia', {
    is: 'EXTERNA',
    then: Joi.string().trim().min(5).max(255).required(),
    otherwise: Joi.string().allow(null, ''),
  }),
  papa_id: Joi.number().integer().allow(null),
  mama_id: Joi.number().integer().allow(null),
  descripcion: Joi.string().max(500).allow(null, ''),
}).options({ stripUnknown: true });

// ── Familia manual ──────────────────────────────────────────────────────────
// Permite crear una familia sin que los padres existan en EDI.Usuarios.
// Se pide al menos uno (papá o mamá) por nombre+apellido. El backend genera
// el nombre_familia con la misma fórmula que el frontend (1er apellido de
// cada uno, o ambos apellidos si solo hay uno).
const nombreCampoOpt   = Joi.string().trim().min(1).max(100).allow(null, '').optional();
const apellidoCampoOpt = Joi.string().trim().min(1).max(100).allow(null, '').optional();

exports.createFamiliaManual = Joi.object({
  papa_nombre:   nombreCampoOpt,
  papa_apellido: apellidoCampoOpt,
  mama_nombre:   nombreCampoOpt,
  mama_apellido: apellidoCampoOpt,
  residencia: residenciaEnum.required(),
  direccion: Joi.when('residencia', {
    is: 'EXTERNA',
    then: Joi.string().trim().min(5).max(255).required(),
    otherwise: Joi.string().allow(null, '').optional(),
  }),
  descripcion: Joi.string().max(500).allow(null, '').optional(),
  // Opcional: si el admin quiere forzar un nombre concreto en vez del autogenerado
  nombre_familia: Joi.string().trim().max(100).allow(null, '').optional(),
})
  .or('papa_nombre', 'mama_nombre')   // al menos uno
  .options({ stripUnknown: true });

// ── Vinculación usuario → familia pendiente ─────────────────────────────────
// Usado tanto por el flujo "elige tu familia" post-registro como por el
// panel admin para forzar una vinculación.
exports.linkUserToFamily = Joi.object({
  id_usuario: Joi.number().integer().required(),
  rol: Joi.string().valid('PAPA', 'MAMA').required(),
}).options({ stripUnknown: true });
