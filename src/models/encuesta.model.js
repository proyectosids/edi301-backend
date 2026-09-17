const Joi = require('joi');
const option = Joi.string().trim().min(1).max(500);
const question = Joi.object({
  texto: Joi.string().trim().min(1).max(1000).required(),
  tipo: Joi.string().valid('UNICA', 'MULTIPLE', 'LIBRE').required(),
  requerida: Joi.boolean().default(true),
  opciones: Joi.when('tipo', {
    is: Joi.valid('UNICA', 'MULTIPLE'),
    then: Joi.array().items(option).min(2).max(20).required(),
    otherwise: Joi.array().max(0).default([]),
  }),
});

// Configuracion del sorteo, cuando la encuesta se crea directamente para
// una muestra. Es el mismo shape que acepta POST /:id/muestra.
const configMuestra = Joi.object({
  tamano: Joi.number().integer().min(1).max(100000),
  cuotas: Joi.object().pattern(
    Joi.string().valid('PADRES', 'HIJOS'),
    Joi.number().integer().min(0).max(100000),
  ),
  incluir_colivi: Joi.boolean().default(false),
  semilla: Joi.string().trim().max(64).allow('', null),
})
  .oxor('tamano', 'cuotas')
  .or('tamano', 'cuotas');

exports.createEncuesta = Joi.object({
  titulo: Joi.string().trim().min(1).max(200).required(),
  descripcion: Joi.string().allow('', null).max(1000),
  fecha_limite: Joi.date().iso().allow(null),
  estado: Joi.string().valid('BORRADOR', 'PUBLICADA').default('BORRADOR'),
  audiencia: Joi.string().valid('TODOS', 'MUESTRA').default('TODOS'),
  // Obligatoria si la audiencia es MUESTRA, prohibida si no: sin esto se
  // podria crear una encuesta "de muestra" sin muestra, que no veria nadie.
  muestra: Joi.when('audiencia', {
    is: 'MUESTRA',
    then: configMuestra.required(),
    otherwise: Joi.any().strip(),
  }),
  preguntas: Joi.array().items(question).min(1).max(50).required(),
});

// Al editar no se toca la audiencia: eso se maneja desde la pantalla de
// muestra, que ademas avisa de las consecuencias si ya hay respuestas.
exports.updateEncuesta = Joi.object({
  titulo: Joi.string().trim().min(1).max(200).required(),
  descripcion: Joi.string().allow('', null).max(1000),
  fecha_limite: Joi.date().iso().allow(null),
  estado: Joi.string().valid('BORRADOR', 'PUBLICADA').default('BORRADOR'),
  preguntas: Joi.array().items(question).min(1).max(50).required(),
});
exports.submitRespuesta = Joi.object({
  respuestas: Joi.array().items(Joi.object({
    id_pregunta: Joi.number().integer().required(),
    opciones: Joi.array().items(Joi.number().integer()).max(20),
    texto_libre: Joi.string().trim().max(5000).allow('', null),
  })).min(1).max(50).required(),
});

// Sorteo de la muestra. `tamano` y `cuotas` son excluyentes y al menos uno
// tiene que venir: sin ninguno no hay nada que sortear.
exports.sortearMuestra = Joi.object({
  tamano: Joi.number().integer().min(1).max(100000),
  cuotas: Joi.object().pattern(
    Joi.string().valid('PADRES', 'HIJOS'),
    Joi.number().integer().min(0).max(100000),
  ),
  incluir_colivi: Joi.boolean().default(false),
  semilla: Joi.string().trim().max(64).allow('', null),
  reemplazar: Joi.boolean().default(false),
})
  .oxor('tamano', 'cuotas')
  .or('tamano', 'cuotas');
