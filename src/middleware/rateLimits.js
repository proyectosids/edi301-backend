const { rateLimit } = require('express-rate-limit');

function jsonHandler(_req, res) {
  res.status(429).json({ error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' });
}

const common = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: jsonHandler,
};

const apiLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT || 1000),
  skip: req => req.method === 'OPTIONS',
});

const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 30),
});

const searchLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: Number(process.env.SEARCH_RATE_LIMIT || 60),
});

module.exports = { apiLimiter, authLimiter, searchLimiter };
