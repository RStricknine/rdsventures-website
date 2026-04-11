const { getIdentity } = require('../../shared/auth');
const sql = require("mssql");

function json(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function getSqlConfig() {
  return {
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: parseInt(process.env.SQL_PORT || "1433", 10),
    options: {
      encrypt: true,
      trustServerCertificate: false
    }
  };
}

module.exports = async function (context, req) {
  try {
    const identity = getIdentity(req);

    const pool = await sql.connect(getSqlConfig());

    const result = await pool.request()
      .input("Email", sql.NVarChar(320), identity.email)
      .input("AadObjectId", sql.UniqueIdentifier, identity.aadObjectId || null)
      .query(`
        SELECT TOP 1 EmployeeProfileId
        FROM dbo.EmployeeProfiles
        WHERE IsActive = 1
      `);

    context.res = json(200, {
      ok: true,
      step: "employee_lookup",
      result: result.recordset
    });

  } catch (err) {
    context.res = json(500, {
      ok: false,
      step: "catch",
      error: err.message
    });
  }
};