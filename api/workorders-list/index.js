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
      SELECT TOP 200
        w.RowID,
        w.WorkOrderNumber,
        w.Subject,
        w.Status,
        w.Priority,
        w.StartDate,
        w.Address,
        c.Name AS CustomerName
      FROM dbo.stg_WorkOrders w
      LEFT JOIN dbo.Customers c
        ON w.CustomerId = c.CustomerId
      ORDER BY w.Created DESC, w.RowID DESC
    `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (error) {
    context.log.error("Work orders list API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load work orders",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
