

const sql = require("mssql");

function json(status, body) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function getUserFromHeaders(req) {
  const clientPrincipalHeader =
    req.headers["x-ms-client-principal"] ||
    req.headers["X-MS-CLIENT-PRINCIPAL"];

  if (!clientPrincipalHeader) return null;

  try {
    const decoded = Buffer.from(clientPrincipalHeader, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    return principal;
  } catch (err) {
    return null;
  }
}

function getUserEmail(principal) {
  if (!principal || !Array.isArray(principal.claims)) return null;

  const emailClaim =
    principal.claims.find(c => c.typ === "preferred_username") ||
    principal.claims.find(c => c.typ === "emails") ||
    principal.claims.find(c => c.typ === "email") ||
    principal.claims.find(c => c.typ === "upn");

  return emailClaim ? String(emailClaim.val || "").trim() : null;
}

function getAadObjectId(principal) {
  if (!principal || !Array.isArray(principal.claims)) return null;

  const oidClaim =
    principal.claims.find(c => c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier") ||
    principal.claims.find(c => c.typ === "oid");

  return oidClaim ? String(oidClaim.val || "").trim() : null;
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
    const principal = getUserFromHeaders(req);
    const email = getUserEmail(principal);
    const aadObjectId = getAadObjectId(principal);

    if (!email && !aadObjectId) {
      context.res = json(401, { ok: false, error: "User identity not found." });
      return;
    }

    pool = await sql.connect(getSqlConfig());

    const request = pool.request();
    request.input("Email", sql.NVarChar(320), email);
    request.input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null);

    const result = await request.query(`
      SET NOCOUNT ON;

      DECLARE @EmployeeProfileId UNIQUEIDENTIFIER;

      SELECT TOP 1
        @EmployeeProfileId = ep.EmployeeProfileId
      FROM dbo.EmployeeProfiles ep
      WHERE ep.IsActive = 1
        AND (
          (@AadObjectId IS NOT NULL AND ep.AadObjectId = @AadObjectId)
          OR (@Email IS NOT NULL AND LOWER(ep.Email) = LOWER(@Email))
        );

      IF @EmployeeProfileId IS NULL
      BEGIN
        SELECT
          CAST(NULL AS UNIQUEIDENTIFIER) AS employeeProfileId,
          CAST(NULL AS NVARCHAR(50)) AS entryType,
          CAST(NULL AS INT) AS workOrderRowId,
          CAST(NULL AS NVARCHAR(100)) AS workOrderNumber,
          CAST(NULL AS DATETIME2) AS startTime,
          CAST(NULL AS DATETIME2) AS endTime,
          CAST(NULL AS DECIMAL(10,2)) AS hoursWorked,
          CAST(NULL AS NVARCHAR(2000)) AS notes
        WHERE 1 = 0;

        RETURN;
      END

      SELECT
        te.EmployeeProfileId AS employeeProfileId,
        tet.Code AS entryType,
        te.WorkOrderRowId AS workOrderRowId,
        COALESCE(te.WorkOrderNumber, wo.ExternalWorkOrderNumber, wo.WorkOrderNumber) AS workOrderNumber,
        te.StartTime AS startTime,
        te.EndTime AS endTime,
        te.HoursWorked AS hoursWorked,
        te.Notes AS notes
      FROM dbo.TimeEntries te
      LEFT JOIN dbo.TimeEntryTypes tet
        ON tet.TimeEntryTypeId = te.TimeEntryTypeId
      LEFT JOIN dbo.stg_WorkOrders wo
        ON wo.RowID = te.WorkOrderRowId
      WHERE te.EmployeeProfileId = @EmployeeProfileId
        AND te.WorkDate = CAST(GETDATE() AS DATE)
      ORDER BY te.StartTime DESC, te.CreatedAt DESC;
    `);

    context.res = json(200, {
      ok: true,
      items: result.recordset || []
    });
  } catch (err) {
    context.log.error("timeentries/today error", err);
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