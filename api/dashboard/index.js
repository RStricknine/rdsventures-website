const sql = require("mssql");

let pool;

async function getPool() {
  if (pool) return pool;

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

module.exports = async function (context, req) {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.Customers WHERE IsDeleted = 0) AS customers,
        (SELECT COUNT(*) FROM dbo.Properties WHERE IsDeleted = 0) AS properties,
        (SELECT COUNT(*) FROM dbo.stg_WorkOrders WHERE Status IN ('Warranty', 'Dispatched')) AS openWorkOrders
    `);

    const row = result.recordset[0] || {};

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        customers: row.customers || 0,
        properties: row.properties || 0,
        openWorkOrders: row.openWorkOrders || 0
      }
    };
  } catch (err) {
    context.log.error("DASHBOARD ERROR:", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: true,
        message: err.message,
        stack: err.stack
      }
    };
  }
};