const sql = require("mssql");
const { getIdentity } = require('../shared/auth');

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
        error: "No usable identity found."
      });
      return;
    }

    pool = await sql.connect(getSqlConfig());

    const request = pool.request();
    request.input("Email", sql.NVarChar(320), email);
    request.input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null);

    const result = await request.query(`
      SET NOCOUNT ON;

      SELECT TOP 1
        ep.EmployeeProfileId,
        ep.AadObjectId,
        ep.Email,
        ep.DisplayName,
        ep.EmployeeType,
        ep.TimeEntryMode,
        ep.CanApproveTime,
        ep.IsTechnician,
        ep.IsOfficeStaff,
        ep.IsActive
      FROM dbo.EmployeeProfiles ep
      WHERE ep.IsActive = 1
        AND (
          (@AadObjectId IS NOT NULL AND ep.AadObjectId = @AadObjectId)
          OR (@Email IS NOT NULL AND LOWER(ep.Email) = LOWER(@Email))
        );
    `);

    const user = result.recordset && result.recordset[0];

    if (!user) {
      context.res = json(404, {
        ok: false,
        error: "EmployeeProfile not found.",
        auth: {
          email,
          aadObjectId,
          source: identity.source || null
        }
      });
      return;
    }

    context.res = json(200, {
      ok: true,
      user: {
        employeeProfileId: user.EmployeeProfileId,
        aadObjectId: user.AadObjectId,
        email: user.Email,
        displayName: user.DisplayName,
        employeeType: user.EmployeeType,
        timeEntryMode: user.TimeEntryMode,
        canApproveTime: !!user.CanApproveTime,
        isTechnician: !!user.IsTechnician,
        isOfficeStaff: !!user.IsOfficeStaff,
        isActive: !!user.IsActive
      }
    });
  } catch (err) {
    context.log.error("api/me error", err);
    context.res = json(500, {
      ok: false,
      error: err.message || "Server error."
    });
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch (_) {}
    }
  }
};