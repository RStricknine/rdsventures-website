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
    const customerId = req.query.customerId;

    if (!customerId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "customerId is required." }
      };
      return;
    }

    const db = await getPool();

    const result = await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .query(`
        SELECT
          PropertyId,
          CustomerId,
          Address,
          City,
          State,
          PostalCode,
          IsActive
        FROM dbo.Properties
        WHERE CustomerId = @CustomerId
        ORDER BY Address
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (error) {
    context.log.error("Customer properties API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load customer properties",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
