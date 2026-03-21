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

    const countsResult = await db.request().query(`
      SELECT
          (SELECT COUNT(*)
           FROM dbo.Customers
           WHERE IsDeleted = 0) AS Customers,

          (SELECT COUNT(*)
           FROM dbo.Properties
           WHERE IsDeleted = 0) AS Properties,

          (SELECT COUNT(*)
           FROM dbo.stg_WorkOrders
           WHERE Status IN ('Warranty', 'Dispatched')) AS OpenWorkOrders,

          (SELECT COUNT(*)
           FROM dbo.stg_WorkOrders
           WHERE Created >= DATEADD(DAY, -7, GETUTCDATE())) AS NewRequests;
    `);

    const activityResult = await db.request().query(`
      SELECT TOP 10
          CONCAT(
              'WO ',
              ISNULL(WorkOrderNumber, CAST(RowID AS nvarchar(20))),
              CASE
                  WHEN Subject IS NOT NULL AND LTRIM(RTRIM(Subject)) <> ''
                  THEN ' - ' + Subject
                  ELSE ''
              END,
              CASE
                  WHEN Address IS NOT NULL AND LTRIM(RTRIM(Address)) <> ''
                  THEN ' @ ' + Address
                  ELSE ''
              END
          ) AS Activity
      FROM dbo.stg_WorkOrders
      ORDER BY Created DESC, RowID DESC;
    `);

    const counts = countsResult.recordset[0] || {};

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        customers: counts.Customers ?? 0,
        properties: counts.Properties ?? 0,
        openWorkOrders: counts.OpenWorkOrders ?? 0,
        newRequests: counts.NewRequests ?? 0,
        recentActivity: activityResult.recordset.map(r => r.Activity)
      }
    };
  } catch (error) {
    context.log.error("Dashboard API error:", error);

    context.res = {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        error: "Failed to load dashboard data"
      }
    };
  }
};