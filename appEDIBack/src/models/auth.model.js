const Joi = require('joi');

exports.loginSchema = Joi.object({
  login: Joi.alternatives().try(
    Joi.string().email(),
    Joi.string().pattern(/^\d+$/) 
  ).required(),
  password: Joi.string().min(6).required()
});
