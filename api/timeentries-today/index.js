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
    const email = identity.email;
    const aadObjectId = identity.aadObjectId;
    const workDate = String((req.query && req.query.workDate) || "").trim();

    if (!email && !aadObjectId) {
      context.res = json(401, { ok: false, error: "User identity not found." });
      return;
    }

    if (!workDate) {
      context.res = json(400, { ok: false, error: "workDate is required." });
      return;
    }

    pool = await sql.connect(getSqlConfig());

    const lookup = await pool.request()
      .input("Email", sql.NVarChar(320), email)
      .input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null)
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

    if (!employee || !employee.EmployeeProfileId) {
      context.res = json(404, {
        ok: false,
        error: "EmployeeProfile not found."
      });
      return;
    }

    const entries = await pool.request()
      .input("EmployeeProfileId", sql.UniqueIdentifier, employee.EmployeeProfileId)
      .input("WorkDate", sql.Date, workDate)
      .query(`
        SELECT
          te.TimeEntryId AS timeEntryId,
          te.EmployeeProfileId AS employeeProfileId,
          te.WorkOrderRowId AS workOrderRowId,
          te.WorkOrderNumber AS workOrderNumber,
          te.StartTime AS startTime,
          te.EndTime AS endTime,
          te.HoursWorked AS hoursWorked,
          te.LaborType AS laborType,
          te.Notes AS notes,
          te.WorkDate AS workDate
        FROM dbo.TimeEntries te
        WHERE te.IsDeleted = 0
          AND te.EmployeeProfileId = @EmployeeProfileId
          AND te.WorkDate = @WorkDate
        ORDER BY te.StartTime DESC, te.CreatedAt DESC;
      `);

    context.res = json(200, {
      ok: true,
      items: entries.recordset || []
    });
  } catch (err) {
    context.res = json(500, {
      ok: false,
      error: err.message || "Server error."
    });
  } finally {
    if (pool) {
      try { await pool.close(); } catch (_) {}
    }
  }
};