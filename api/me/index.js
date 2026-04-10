const sql = require("mssql");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const tenantId = "a15e3ac7-dc12-4e8c-b596-ae0f12a7cf66";
const mobileClientId = "f4ee7068-746a-4329-80bb-98dfeedd42db";

const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const jwks = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
);

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

function getBearerToken(req) {
  const auth =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (!auth.startsWith("Bearer ")) return null;
  return auth.substring("Bearer ".length).trim();
}

async function verifyBearerToken(token) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: mobileClientId
  });

  return payload;
}

module.exports = async function (context, req) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      context.res = {
        status: 401,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "Missing bearer token"
        }
      };
      return;
    }

    const claims = await verifyBearerToken(token);

    const aadObjectId = claims.oid;
    const email =
      claims.preferred_username ||
      claims.email ||
      null;
    const displayName =
      claims.name ||
      email ||
      "Unknown User";

    if (!aadObjectId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "Token did not contain oid claim"
        }
      };
      return;
    }

    const db = await getPool();

    const existing = await db.request()
      .input("AadObjectId", sql.NVarChar(100), aadObjectId)
      .query(`
        SELECT TOP 1 *
        FROM dbo.EmployeeProfiles
        WHERE AadObjectId = @AadObjectId
      `);

    let profile;

    if (existing.recordset.length > 0) {
      profile = existing.recordset[0];
    } else {
      const inserted = await db.request()
        .input("AadObjectId", sql.NVarChar(100), aadObjectId)
        .input("Email", sql.NVarChar(255), email)
        .input("DisplayName", sql.NVarChar(200), displayName)
        .query(`
          INSERT INTO dbo.EmployeeProfiles
          (
            AadObjectId,
            Email,
            DisplayName
          )
          OUTPUT INSERTED.*
          VALUES
          (
            @AadObjectId,
            @Email,
            @DisplayName
          )
        `);

      profile = inserted.recordset[0];
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        ok: true,
        user: {
          employeeProfileId: profile.EmployeeProfileId,
          aadObjectId: profile.AadObjectId,
          email: profile.Email,
          displayName: profile.DisplayName,
          employeeType: profile.EmployeeType,
          timeEntryMode: profile.TimeEntryMode,
          canApproveTime: profile.CanApproveTime,
          isTechnician: profile.IsTechnician,
          isOfficeStaff: profile.IsOfficeStaff,
          isActive: profile.IsActive
        }
      }
    };
  } catch (err) {
    context.log.error("api/me error", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load user",
        message: err.message
      }
    };
  }
};