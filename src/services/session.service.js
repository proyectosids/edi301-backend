const { sql, queryP } = require('../dataBase/dbConnection');
const UQ = require('../queries/usuarios.queries').Q;

const RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS || 90);

async function purgeInactiveSessions() {
  const result = await queryP(UQ.purgeInactiveSessions, {
    days: { type: sql.Int, value: RETENTION_DAYS },
  });
  // mssql no devuelve filas para DELETE sin OUTPUT; el mensaje deja trazabilidad
  // sin registrar tokens ni datos personales.
  console.log(`Limpieza de sesiones inactivas ejecutada (retención: ${RETENTION_DAYS} días).`);
  return result;
}

module.exports = { purgeInactiveSessions };
