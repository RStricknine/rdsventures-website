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
    const q = (req.query.q || "").trim();

    if (!q) {
      context.res = {
        status: 200,
        body: []
      };
      return;
    }

    const db = await getPool();

    const result = await db.request()
      .input("q", sql.NVarChar(200), `%${q}%`)
      .query(`
        SELECT TOP 20 CustomerId, Name
        FROM dbo.Customers
        WHERE Name LIKE @q
        ORDER BY Name
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (error) {
    context.log.error("Customer search error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to search customers",
        message: error.message
      }
    };
  }
};
