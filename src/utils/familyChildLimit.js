const { sql, queryP } = require('../dataBase/dbConnection');

const CONFIG_KEY = 'limite_hijos_edi_por_familia';
const DEFAULT_LIMIT = 7;
const MAX_LIMIT = 20;

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    return DEFAULT_LIMIT;
  }
  return parsed;
}

async function getEdiChildLimit() {
  const rows = await queryP(
    'SELECT valor FROM EDI.App_Config WHERE clave = @clave',
    { clave: { type: sql.NVarChar, value: CONFIG_KEY } },
  );
  return normalizeLimit(rows[0]?.valor);
}

async function getEdiChildCount(idFamilia) {
  const rows = await queryP(
    `SELECT COUNT(*) AS total
     FROM EDI.Miembros_Familia mf
     JOIN EDI.Usuarios u ON u.id_usuario = mf.id_usuario
     JOIN EDI.Roles r ON r.id_rol = u.id_rol
     WHERE mf.id_familia = @id_familia
       AND mf.activo = 1
       AND u.activo = 1
       AND r.nombre_rol = 'HijoEDI'`,
    { id_familia: { type: sql.Int, value: Number(idFamilia) } },
  );
  return Number(rows[0]?.total || 0);
}

async function countEdiChildrenForUsers(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number))]
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return 0;

  const params = {};
  const placeholders = ids.map((id, index) => {
    const name = `id_${index}`;
    params[name] = { type: sql.Int, value: id };
    return `@${name}`;
  });
  const rows = await queryP(
    `SELECT COUNT(*) AS total
     FROM EDI.Usuarios u
     JOIN EDI.Roles r ON r.id_rol = u.id_rol
     WHERE u.id_usuario IN (${placeholders.join(', ')})
       AND u.activo = 1
       AND r.nombre_rol = 'HijoEDI'`,
    params,
  );
  return Number(rows[0]?.total || 0);
}

async function canAddEdiChildren(idFamilia, candidateUserIds = []) {
  const [limit, current, familyRows] = await Promise.all([
    getEdiChildLimit(),
    getEdiChildCount(idFamilia),
    queryP(
      `SELECT cerrada_manualmente
       FROM EDI.Familias_EDI
       WHERE id_familia = @id_familia AND activo = 1`,
      { id_familia: { type: sql.Int, value: Number(idFamilia) } },
    ),
  ]);
  const requested = await countEdiChildrenForUsers(candidateUserIds);
  const manuallyClosed = familyRows[0]?.cerrada_manualmente === true ||
    familyRows[0]?.cerrada_manualmente === 1;
  return {
    // Un hijo sanguíneo no consume cupo, incluso si los cupos se cerraron.
    allowed: requested === 0 || (!manuallyClosed && current + requested <= limit),
    limit,
    current,
    requested,
    manuallyClosed,
  };
}

function limitError({ limit, current, requested, manuallyClosed = false }) {
  if (manuallyClosed) {
    return 'Esta familia fue marcada manualmente como llena y no admite más hijos EDI.';
  }
  const remaining = Math.max(limit - current, 0);
  return `Esta familia tiene un límite de ${limit} hijo(s) EDI. Actualmente tiene ${current} y solo puede agregar ${remaining} más (se solicitaron ${requested}).`;
}

module.exports = {
  CONFIG_KEY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeLimit,
  getEdiChildLimit,
  countEdiChildrenForUsers,
  canAddEdiChildren,
  limitError,
};
