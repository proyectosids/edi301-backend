// Límite en memoria: protege SQL Server y bcrypt ante ráfagas de contraseñas
// erróneas sin requerir una dependencia o servicio adicional.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const MAX_KEYS = 50000;

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString()
    .split(',')[0]
    .trim();
}

function cleanup(now) {
  if (attempts.size <= MAX_KEYS) return;
  for (const [key, value] of attempts) {
    if (now - value.startedAt >= WINDOW_MS) attempts.delete(key);
  }
}

module.exports = function loginRateLimit(req, res, next) {
  const now = Date.now();
  const login = String(req.body?.login || '').trim().toLowerCase();
  const key = `${clientIp(req)}:${login}`;
  const previous = attempts.get(key);
  const entry = !previous || now - previous.startedAt >= WINDOW_MS
    ? { count: 0, startedAt: now }
    : previous;

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.startedAt)) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' });
  }

  entry.count += 1;
  attempts.set(key, entry);
  cleanup(now);

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) attempts.delete(key);
  });
  next();
};
