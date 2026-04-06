const sql = require("mssql");

let pool;

async function getPool() {
  if (pool) return pool;

  if (!process.env.SQL_SERVER) {
    throw new Error("Missing SQL_SERVER environment variable");
  }

  pool = await sql.connect({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: parseInt(process.env.SQL_PORT || "1433", 10),
    options: {
      encrypt: true,
      trustServerCertificate: false
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  });

  return pool;
}

module.exports = {
  sql,
  getPool
};