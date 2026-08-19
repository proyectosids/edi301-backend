const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { getPagination } = require('../src/utils/pagination');
const { Q: chatQueries } = require('../src/queries/chat.queries');
const { Q: userQueries } = require('../src/queries/usuarios.queries');

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
