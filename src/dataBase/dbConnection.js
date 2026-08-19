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
  // Un pool pequeño convierte cada ráfaga de peticiones autenticadas en una
  // fila de espera. Se puede ajustar por entorno sin volver a desplegar.
  pool: {
    max: Number(process.env.DB_POOL_MAX || 20),
    min: Number(process.env.DB_POOL_MIN || 0),
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 60000),
  },
  connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000),
  requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 30000),
  options: {
    encrypt: false,                        
    trustServerCertificate: true,
    enableArithAbort: true               
  }
};

const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect(); // inicia la conexión

async function getConnection() {
  await poolConnect; // Espera a que la conexión esté lista
  return pool;
}

async function queryP(query, params = {}) {
  await poolConnect;
  const request = pool.request();
  for (const [k, v] of Object.entries(params)) {
    request.input(k, v.type || sql.NVarChar, v.value);
  }
  const result = await request.query(query);
  return result.recordset;
}

module.exports = { sql, queryP, pool, getConnection };
