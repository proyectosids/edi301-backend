const sql = require('mssql');

const EXPECTED_ROLLBACK_ERRORS = new Set(['EABORT', 'ENOTBEGUN']);

async function rollbackSafely(transaction, label = 'transaction') {
  try {
    await transaction.rollback();
    return true;
  } catch (error) {
    if (!EXPECTED_ROLLBACK_ERRORS.has(error?.code)) {
      console.error(`[database] No se pudo revertir ${label}:`, error);
    }
    return false;
  }
}

async function runInTransaction(pool, work, options = {}) {
  const transaction = new sql.Transaction(pool);
  let started = false;

  try {
    await transaction.begin(options.isolationLevel);
    started = true;
    const result = await work(transaction);
    await transaction.commit();
    started = false;
    return result;
  } catch (error) {
    if (started) await rollbackSafely(transaction, options.label);
    throw error;
  }
}

module.exports = { rollbackSafely, runInTransaction };
