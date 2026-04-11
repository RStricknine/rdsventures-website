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
      context.res = json(401, {
        ok: false,
        step: "identity",
        error: "User identity not found."
      });
      return;
    }

    pool = await sql.connect(getSqlConfig());

    // Step 1: employee lookup only
    const lookupRequest = pool.request();
    lookupRequest.input("Email", sql.NVarChar(320), email);
    lookupRequest.input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null);

    const lookupResult = await lookupRequest.query(`
      SET NOCOUNT ON;

      SELECT TOP 1
        ep.EmployeeProfileId
      FROM dbo.EmployeeProfiles ep
      WHERE ep.IsActive = 1
        AND (
          (@AadObjectId IS NOT NULL AND ep.AadObjectId = @AadObjectId)
          OR (@Email IS NOT NULL AND LOWER(ep.Email) = LOWER(@Email))
        );
    `);

    const employee = lookupResult.recordset && lookupResult.recordset[0];

    if (!employee || !employee.EmployeeProfileId) {
      context.res = json(404, {
        ok: false,
        step: "employee_lookup",
        error: "EmployeeProfile not found.",
        debug: { email, aadObjectId }
      });
      return;
    }

    // Step 2: bare minimum time query
    const entriesRequest = pool.request();
    entriesRequest.input("EmployeeProfileId", sql.UniqueIdentifier, employee.EmployeeProfileId);

    const entriesResult = await entriesRequest.query(`
      SET NOCOUNT ON;

      SELECT TOP 20
        te.TimeEntryId,
        te.EmployeeProfileId,
        te.WorkDate,
        te.StartTime,
        te.EndTime,
        te.HoursWorked,
        te.Notes,
        te.WorkOrderRowId,
        te.WorkOrderNumber,
        te.CreatedAt
      FROM dbo.TimeEntries te
      WHERE te.EmployeeProfileId = @EmployeeProfileId
      ORDER BY te.CreatedAt DESC;
    `);

    context.res = json(200, {
      ok: true,
      step: "success",
      items: entriesResult.recordset || []
    });
  } catch (err) {
    context.log.error("timeentries/today debug error", err);
    context.res = json(500, {
      ok: false,
      step: "catch",
      error: err.message || "Server error.",
      details: String(err)
    });
  } finally {
    if (pool) {
      try { await pool.close(); } catch (_) {}
    }
  }
};