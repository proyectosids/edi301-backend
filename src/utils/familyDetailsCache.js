const crypto = require('crypto');

const TTL_MS = Math.max(Number(process.env.FAMILY_DETAILS_CACHE_TTL_MS || 30000), 5000);
const STALE_MS = Math.max(Number(process.env.FAMILY_DETAILS_CACHE_STALE_MS || 300000), TTL_MS);

const cachedById = new Map();
const pendingById = new Map();
let invalidationVersion = 0;

function etagFor(id, data) {
  const digest = crypto.createHash('sha1').update(JSON.stringify(data)).digest('base64url');
  return `W/"familia-${id}-${digest}"`;
}

async function getFamilyDetails(id, loader) {
  const key = Number(id);
  const now = Date.now();
  const cached = cachedById.get(key);
  if (cached && cached.expiresAt > now) return { ...cached, cacheStatus: 'HIT' };
  if (pendingById.has(key)) return pendingById.get(key);

  const loadVersion = invalidationVersion;
  const pending = Promise.resolve()
    .then(loader)
    .then((data) => {
      const entry = {
        data,
        etag: etagFor(key, data),
        expiresAt: Date.now() + TTL_MS,
        staleUntil: Date.now() + STALE_MS,
      };
      if (loadVersion === invalidationVersion) cachedById.set(key, entry);
      return { ...entry, cacheStatus: 'MISS' };
    })
    .catch((error) => {
      if (cached && cached.staleUntil > Date.now()) {
        console.warn(`[familia-cache] SQL no disponible para familia ${key}; se responde cache anterior:`, error.message);
        return { ...cached, cacheStatus: 'STALE', error };
      }
      throw error;
    })
    .finally(() => pendingById.delete(key));

  pendingById.set(key, pending);
  return pending;
}

function invalidateFamilyDetails() {
  invalidationVersion++;
  for (const entry of cachedById.values()) entry.expiresAt = 0;
}

function invalidateFamilyDetailsOnSuccess(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) invalidateFamilyDetails();
    });
  }
  next();
}

function resetFamilyDetailsCache() {
  cachedById.clear();
  pendingById.clear();
  invalidationVersion = 0;
}

module.exports = {
  getFamilyDetails,
  invalidateFamilyDetails,
  invalidateFamilyDetailsOnSuccess,
  resetFamilyDetailsCache,
};
