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

function getTokenFromRequest(req) {
  const custom =
    req.headers["x-mobile-id-token"] ||
    req.headers["X-Mobile-ID-Token"];

  if (custom) return custom;

  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (auth.startsWith("Bearer ")) {
    return auth.substring("Bearer ".length).trim();
  }

  return null;
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT format");
  }

  const payload = parts[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json);
}

module.exports = async function (context, req) {
  try {
    const token = getTokenFromRequest(req);

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

    const claims = decodeJwtPayload(token);

    const aadObjectId = claims.oid || null;
    const email = claims.preferred_username || claims.email || null;
    const displayName = claims.name || email || "Unknown User";

    if (!aadObjectId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "Token did not contain oid claim",
          claimsPreview: {
            iss: claims.iss || null,
            aud: claims.aud || null,
            sub: claims.sub || null,
            preferred_username: claims.preferred_username || null,
            name: claims.name || null,
            oid: claims.oid || null
          }
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
        message: err.message,
        code: err.code || null,
        name: err.name || null
      }
    };
  }
};