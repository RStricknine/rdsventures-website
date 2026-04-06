let sql;

try {
  sql = require("mssql");
} catch (err) {
  module.exports = async function (context, req) {
    context.res = {
      status: 500,
      body: {
        error: "mssql failed to load",
        message: err.message
      }
    };
  };
  return;
}

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
    context.log("dashboard function started");

    const configCheck = {
      SQL_SERVER: !!process.env.SQL_SERVER,
      SQL_DATABASE: !!process.env.SQL_DATABASE,
      SQL_USER: !!process.env.SQL_USER,
      SQL_PASSWORD: !!process.env.SQL_PASSWORD,
      SQL_PORT: process.env.SQL_PORT || "1433"
    };

    context.log("dashboard config check", configCheck);

    let db;
    try {
      db = await getPool();
      context.log("sql connection established");
    } catch (connectErr) {
      context.log.error("SQL CONNECT ERROR:", connectErr);

      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: {
          stage: "connect",
          error: true,
          message: connectErr.message,
          configCheck
        }
      };
      return;
    }

    let result;
    try {
      result = await db.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.Customers WHERE IsDeleted = 0) AS customers,
          (SELECT COUNT(*) FROM dbo.Properties WHERE IsDeleted = 0) AS properties,
          (SELECT COUNT(*) FROM dbo.stg_WorkOrders WHERE Status IN ('Warranty', 'Dispatched')) AS openWorkOrders
      `);
      context.log("dashboard query succeeded");
    } catch (queryErr) {
      context.log.error("SQL QUERY ERROR:", queryErr);

      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: {
          stage: "query",
          error: true,
          message: queryErr.message
        }
      };
      return;
    }

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
    context.log.error("DASHBOARD UNHANDLED ERROR:", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        stage: "unhandled",
        error: true,
        message: err.message,
        stack: err.stack
      }
    };
  }
};
