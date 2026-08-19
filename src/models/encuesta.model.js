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

exports.createEncuesta = Joi.object({
  titulo: Joi.string().trim().min(1).max(200).required(),
  descripcion: Joi.string().allow('', null).max(1000),
  fecha_limite: Joi.date().iso().allow(null),
  estado: Joi.string().valid('BORRADOR', 'PUBLICADA').default('BORRADOR'),
  preguntas: Joi.array().items(question).min(1).max(50).required(),
});
exports.updateEncuesta = exports.createEncuesta;
exports.submitRespuesta = Joi.object({
  respuestas: Joi.array().items(Joi.object({
    id_pregunta: Joi.number().integer().required(),
    opciones: Joi.array().items(Joi.number().integer()).max(20),
    texto_libre: Joi.string().trim().max(5000).allow('', null),
  })).min(1).max(50).required(),
});
