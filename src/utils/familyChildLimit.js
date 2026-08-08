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
     FROM EDI.Miembros_Familia
     WHERE id_familia = @id_familia
       AND activo = 1
       AND tipo_miembro IN ('HIJO', 'ALUMNO_ASIGNADO')`,
    { id_familia: { type: sql.Int, value: Number(idFamilia) } },
  );
  return Number(rows[0]?.total || 0);
}

async function canAddEdiChildren(idFamilia, amount = 1) {
  const [limit, current] = await Promise.all([
    getEdiChildLimit(),
    getEdiChildCount(idFamilia),
  ]);
  const requested = Number(amount) || 0;
  return {
    allowed: current + requested <= limit,
    limit,
    current,
    requested,
  };
}

function limitError({ limit, current, requested }) {
  const remaining = Math.max(limit - current, 0);
  return `Esta familia tiene un límite de ${limit} hijo(s) EDI. Actualmente tiene ${current} y solo puede agregar ${remaining} más (se solicitaron ${requested}).`;
}

module.exports = {
  CONFIG_KEY,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeLimit,
  getEdiChildLimit,
  canAddEdiChildren,
  limitError,
};
