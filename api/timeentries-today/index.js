
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
  te.WorkOrderRowId AS workOrderRowId,
  te.WorkOrderNumber AS workOrderNumber,
  te.StartTime AS startTime,
  te.EndTime AS endTime,
  te.HoursWorked AS hoursWorked,
  te.Notes AS notes
FROM dbo.TimeEntries te
WHERE te.IsDeleted = 0
  AND te.EmployeeProfileId = @EmployeeProfileId
  AND te.WorkDate = CAST(GETDATE() AS DATE)
ORDER BY te.StartTime DESC, te.CreatedAt DESC;

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