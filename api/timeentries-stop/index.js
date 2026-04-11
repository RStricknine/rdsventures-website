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
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

module.exports = async function (context, req) {
  let pool;

  try {
    const identity = getIdentity(req);
    const email = identity.email;
    const aadObjectId = identity.aadObjectId;

    if (!email && !aadObjectId) {
      context.res = json(401, { ok: false, error: "User identity not found." });
      return;
    }

    pool = await sql.connect(getSqlConfig());

    // Step 1: find employee
    const lookup = await pool.request()
      .input("Email", sql.NVarChar(320), email)
      .input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null)
      .query(`
        SELECT TOP 1
          ep.EmployeeProfileId
        FROM dbo.EmployeeProfiles ep
        WHERE ep.IsActive = 1
          AND (
            (@AadObjectId IS NOT NULL AND ep.AadObjectId = @AadObjectId)
            OR (@Email IS NOT NULL AND LOWER(ep.Email) = LOWER(@Email))
          );
      `);

    const employee = lookup.recordset[0];

    if (!employee) {
      context.res = json(400, { ok: false, error: "EmployeeProfile not found." });
      return;
    }

    // Step 2: find open entry
    const openResult = await pool.request()
      .input("EmployeeProfileId", sql.UniqueIdentifier, employee.EmployeeProfileId)
      .query(`
        SELECT TOP 1
          te.TimeEntryId,
          te.StartTime,
          te.BreakMinutes
        FROM dbo.TimeEntries te
        WHERE te.EmployeeProfileId = @EmployeeProfileId
          AND te.IsDeleted = 0
          AND te.EndTime IS NULL
        ORDER BY te.CreatedAt DESC;
      `);

    const openEntry = openResult.recordset[0];

    if (!openEntry) {
      context.res = json(400, {
        ok: false,
        error: "No open time entry found."
      });
      return;
    }

    // Step 3: close it
    const updateResult = await pool.request()
      .input("TimeEntryId", sql.UniqueIdentifier, openEntry.TimeEntryId)
      .query(`
        DECLARE @EndTime DATETIME2 = GETDATE();

        UPDATE dbo.TimeEntries
        SET
          EndTime = @EndTime,
          HoursWorked =
            ROUND(
              DATEDIFF(MINUTE, StartTime, @EndTime) / 60.0
              - ISNULL(BreakMinutes, 0) / 60.0,
              2
            ),
          ModifiedAt = SYSUTCDATETIME()
        OUTPUT
          inserted.TimeEntryId,
          inserted.StartTime,
          inserted.EndTime,
          inserted.HoursWorked
        WHERE TimeEntryId = @TimeEntryId;

      `);

    context.res = json(200, {
      ok: true,
      item: updateResult.recordset[0]
    });

  } catch (err) {
    context.log.error("timeentries/stop error", err);
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