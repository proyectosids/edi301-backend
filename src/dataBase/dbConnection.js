const path = require('path');
// El .env vive en la raíz del proyecto. server.js ya lo carga al arrancar,
// pero lo hacemos también aquí por si alguna utilidad importa este módulo
// directamente (scripts, tests).
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const sql = require('mssql');



const dbConfig = {
  user: process.env.DBUSER,                
  password: process.env.DBPASSWORD,        
  server: process.env.DBSERVER || '127.0.0.1', 
  database: process.env.DATABASE,          
  port: Number(process.env.DBPORT || 1433),
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: Number(process.env.DB_POOL_MIN || 0),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 60000),
    acquireTimeoutMillis: Number(process.env.DB_POOL_ACQUIRE_MS || 15000),
  },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 30000),
  options: {
    encrypt: false,                        
    trustServerCertificate: true,
    enableArithAbort: true               
  }
};

const pool = new sql.ConnectionPool(dbConfig);
pool.on('error', (error) => {
  console.error('[database] Error inesperado en el pool:', error.message);
});
const poolConnect = pool.connect(); // inicia la conexión

async function getConnection() {
  await poolConnect; // Espera a que la conexión esté lista
  return pool;
}

async function queryP(query, params = {}) {
  await poolConnect;
  const request = pool.request();
  for (const [k, v] of Object.entries(params)) {
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'value')) {
      request.input(k, v.type || sql.NVarChar, v.value);
    } else {
      request.input(k, v);
    }
  }
  const result = await request.query(query);
  return result.recordset;
}

async function checkConnection() {
  await poolConnect;
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

async function closeConnection() {
  if (pool.connected || pool.connecting) await pool.close();
}

module.exports = { sql, queryP, pool, getConnection, checkConnection, closeConnection };
