const crypto = require('crypto');

const TTL_MS = Math.max(Number(process.env.AVAILABLE_FAMILIES_CACHE_TTL_MS || 60000), 5000);
const STALE_MS = Math.max(Number(process.env.AVAILABLE_FAMILIES_CACHE_STALE_MS || 600000), TTL_MS);

let cached = null;
let pendingLoad = null;
let invalidationVersion = 0;

function etagFor(data) {
  const digest = crypto.createHash('sha1').update(JSON.stringify(data)).digest('base64url');
  return `W/"familias-${digest}"`;
}

async function getAvailableFamilies(loader) {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { ...cached, cacheStatus: 'HIT' };
  }

  if (pendingLoad) return pendingLoad;

  const stale = cached;
  const loadVersion = invalidationVersion;
  pendingLoad = Promise.resolve()
    .then(loader)
    .then((data) => {
      cached = {
        data,
        etag: etagFor(data),
        expiresAt: loadVersion === invalidationVersion ? Date.now() + TTL_MS : 0,
        staleUntil: Date.now() + STALE_MS,
      };
      return { ...cached, cacheStatus: 'MISS' };
    })
    .catch((error) => {
      if (stale && stale.staleUntil > Date.now()) {
        console.warn('[familias-cache] SQL no disponible; se responde cache anterior:', error.message);
        return { ...stale, cacheStatus: 'STALE', error };
      }
      throw error;
    })
    .finally(() => {
      pendingLoad = null;
    });

  return pendingLoad;
}

function invalidateAvailableFamilies() {
  invalidationVersion++;
  if (cached) cached.expiresAt = 0;
}

function invalidateAvailableFamiliesOnSuccess(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) invalidateAvailableFamilies();
    });
  }
  next();
}

function resetAvailableFamiliesCache() {
  cached = null;
  pendingLoad = null;
  invalidationVersion = 0;
}

module.exports = {
  getAvailableFamilies,
  invalidateAvailableFamilies,
  invalidateAvailableFamiliesOnSuccess,
  resetAvailableFamiliesCache,
};
