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
     WHERE mf.id_familia = @id_familia
       AND mf.activo = 1
       AND u.activo = 1
       AND mf.tipo_miembro = 'ALUMNO_ASIGNADO'`,
    { id_familia: { type: sql.Int, value: Number(idFamilia) } },
  );
  return Number(rows[0]?.total || 0);
}

async function countEdiChildrenForUsers(userIds) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).map(Number))]
    .filter(id => Number.isInteger(id) && id > 0);
  // El llamador usa esta función cuando la relación por crear es
  // ALUMNO_ASIGNADO. El rol global no define la relación familiar.
  return ids.length;
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
    // Siete es una meta de balance, no un límite estricto. Solo el cierre
    // manual impide agregar nuevos ALUMNO_ASIGNADO.
    allowed: requested === 0 || !manuallyClosed,
    limit,
    current,
    requested,
    manuallyClosed,
    exceedsRecommended: current + requested > limit,
  };
}

function limitError({ limit, current, requested, manuallyClosed = false }) {
  if (manuallyClosed) {
    return 'Esta familia fue marcada manualmente como llena y no admite más hijos EDI.';
  }
  return `Esta familia tiene una meta recomendada de ${limit} alumno(s) asignado(s). Actualmente tiene ${current} y se solicitaron ${requested}.`;
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
