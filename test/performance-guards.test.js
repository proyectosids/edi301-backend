const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getPagination } = require('../src/utils/pagination');
const { Q: chatQueries } = require('../src/queries/chat.queries');
const { Q: userQueries } = require('../src/queries/usuarios.queries');
const { Q: familyQueries } = require('../src/queries/familias.queries');
const {
  getAvailableFamilies,
  invalidateAvailableFamilies,
  resetAvailableFamiliesCache,
} = require('../src/utils/availableFamiliesCache');

test('pagination applies defaults and hard maximums', () => {
  assert.deepEqual(getPagination({}), { page: 1, limit: 100, offset: 0 });
  assert.deepEqual(
    getPagination({ page: '3', limit: '999' }, { defaultLimit: 50, maxLimit: 200 }),
    { page: 3, limit: 200, offset: 400 }
  );
  assert.deepEqual(getPagination({ page: '-1', limit: '0' }), { page: 1, limit: 100, offset: 0 });
});

test('chat endpoint never performs schema changes at runtime', () => {
  assert.doesNotMatch(chatQueries.markRead, /ALTER\s+TABLE/i);
  assert.match(chatQueries.markRead, /UPDATE\s+EDI\.Chat_Participantes/i);
});

test('session activity writes are throttled', () => {
  assert.match(userQueries.touchSession, /DATEADD\(MINUTE,\s*-5/i);
  const guard = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'middleware', 'authGuard.js'),
    'utf8'
  );
  assert.match(guard, /shouldTouchSession/);
  assert.match(guard, /SESSION_TOUCH_INTERVAL_MS/);
});

test('performance migration contains required schema changes', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '005_performance_and_reliability.sql'),
    'utf8'
  );
  assert.match(migration, /ultima_lectura/i);
  assert.match(migration, /IX_Notificaciones_Usuario_Fecha/i);
  assert.match(migration, /Job_Ejecuciones/i);
});

test('available families query aggregates once instead of correlated XML queries', () => {
  assert.match(familyQueries.listAvailable, /WITH\s+config\s+AS/i);
  assert.match(familyQueries.listAvailable, /STRING_AGG/i);
  assert.doesNotMatch(familyQueries.listAvailable, /FOR\s+XML/i);
});

test('available families migration adds filtered lookup indexes', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '006_available_families_performance.sql'),
    'utf8'
  );
  assert.match(migration, /IX_MiembrosFamilia_Activos_Familia_Tipo/i);
  assert.match(migration, /IX_FamiliasEDI_Activas_Nombre/i);
  assert.match(migration, /WHERE\s+activo\s*=\s*1/i);
});

test('available families cache coalesces concurrent loads', async () => {
  resetAvailableFamiliesCache();
  let loads = 0;
  const loader = async () => {
    loads++;
    await new Promise(resolve => setImmediate(resolve));
    return [{ id_familia: 1 }];
  };
  const [first, second] = await Promise.all([
    getAvailableFamilies(loader),
    getAvailableFamilies(loader),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(first.data, second.data);
  assert.equal((await getAvailableFamilies(loader)).cacheStatus, 'HIT');
});

test('available families cache serves stale data when SQL is temporarily unavailable', async () => {
  resetAvailableFamiliesCache();
  await getAvailableFamilies(async () => [{ id_familia: 7 }]);
  invalidateAvailableFamilies();
  const result = await getAvailableFamilies(async () => {
    throw new Error('SQL timeout');
  });
  assert.equal(result.cacheStatus, 'STALE');
  assert.deepEqual(result.data, [{ id_familia: 7 }]);
});
