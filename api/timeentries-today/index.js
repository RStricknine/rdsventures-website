const { getIdentity } = require('../shared/auth');
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
  let pool;

  try {
    const identity = getIdentity(req);
const workDate = String((req.query && req.query.workDate) || "").trim();


    pool = await sql.connect(getSqlConfig());

    const lookup = await pool.request()
      .input("Email", sql.NVarChar(320), identity.email)
      .input("AadObjectId", sql.UniqueIdentifier, identity.aadObjectId || null)
      .query(`
        SELECT TOP 1 EmployeeProfileId
        FROM dbo.EmployeeProfiles
        WHERE IsActive = 1
          AND (
            (@AadObjectId IS NOT NULL AND AadObjectId = @AadObjectId)
            OR (@Email IS NOT NULL AND LOWER(Email) = LOWER(@Email))
          )
      `);

    const employee = lookup.recordset[0];

    const entries = await pool.request()
      .input("EmployeeProfileId", sql.UniqueIdentifier, employee.EmployeeProfileId)
      .input("WorkDate", sql.Date, workDate || null)
      .query(`
       SELECT
  te.EmployeeProfileId AS employeeProfileId,
  te.WorkOrderRowId AS workOrderRowId,
  te.WorkOrderNumber AS workOrderNumber,
  te.StartTime AS startTime,
  te.EndTime AS endTime,
  te.HoursWorked AS hoursWorked,
  te.Notes AS notes
FROM dbo.TimeEntries te
WHERE te.IsDeleted = 0
  AND te.EmployeeProfileId = @EmployeeProfileId
  AND te.WorkDate = @WorkDate
ORDER BY te.StartTime DESC, te.CreatedAt DESC
      `);

    context.res = json(200, {
      ok: true,
      step: "entries_basic",
      items: entries.recordset
    });

  } catch (err) {
    context.res = json(500, {
      ok: false,
      step: "catch",
      error: err.message
    });
  } finally {
    if (pool) {
      try { await pool.close(); } catch (_) {}
    }
  }
};