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
        c.CustomerId,
        c.Name,
        c.Email,
        c.Phone,
        c.BillingStreet,
        c.BillingCity,
        c.BillingState,
        c.BillingPostalCode,
        c.IsActive,
        c.CustomerTypeId,
        ct.Name as CustomerTypeName
      FROM dbo.Customers c
      LEFT JOIN dbo.CustomerType ct
        ON c.CustomerTypeId = ct.CustomerTypeId
      WHERE c.IsActive = 1
      ORDER BY c.Name
    `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (error) {
    context.log.error("Customer list API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load customers",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
