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
    }
  });

  return pool;
}

module.exports = async function (context, req) {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT TOP 200
        ServiceRequestId,
        RequestName,
        RequestPhone,
        RequestEmail,
        PropertyAddress,
        ServiceType,
        Details,
        RequestStatus,
        CreatedAt
      FROM dbo.ServiceRequests
      WHERE IsDeleted = 0
      ORDER BY CreatedAt DESC
    `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };

  } catch (error) {
    context.log.error(error);

    context.res = {
      status: 500,
      body: { error: "Failed to load service requests" }
    };
  }
};
