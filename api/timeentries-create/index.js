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
    return JSON.parse(decoded);
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

function parseDateTime(workDate, timeValue) {
  if (!workDate || !timeValue) return null;
  return `${workDate}T${timeValue}:00`;
}

function safeDecimalHours(startDateTime, endDateTime, breakMinutes) {
  if (!startDateTime || !endDateTime) return 0;
  const start = new Date(startDateTime);
  const end = new Date(endDateTime);
  const ms = end.getTime() - start.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;

  const rawHours = ms / (1000 * 60 * 60);
  const breakHours = (Number(breakMinutes || 0) / 60);
  const total = rawHours - breakHours;
  return total > 0 ? Number(total.toFixed(2)) : 0;
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

    const body = req.body || {};
    const mode = String(body.mode || "").trim().toLowerCase();
    const workDate = String(body.workDate || "").trim();
    const startTime = String(body.startTime || "").trim();
    const endTime = body.endTime ? String(body.endTime).trim() : null;
    const breakMinutes = Number(body.breakMinutes || 0);
    const laborType = body.laborType ? String(body.laborType).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;
    const workOrderRowId = body.workOrderRowId ? Number(body.workOrderRowId) : null;

    if (!workDate) {
      context.res = json(400, { ok: false, error: "workDate is required." });
      return;
    }

    if (!startTime) {
      context.res = json(400, { ok: false, error: "startTime is required." });
      return;
    }

    if (mode !== "timecard" && mode !== "workorder") {
      context.res = json(400, { ok: false, error: "mode must be timecard or workorder." });
      return;
    }

    if (mode === "workorder" && !workOrderRowId) {
      context.res = json(400, { ok: false, error: "workOrderRowId is required for workorder mode." });
      return;
    }

    const startDateTime = parseDateTime(workDate, startTime);
    const endDateTime = endTime ? parseDateTime(workDate, endTime) : null;
    const hoursWorked = safeDecimalHours(startDateTime, endDateTime, breakMinutes);

    pool = await sql.connect(getSqlConfig());

    const lookupRequest = pool.request();
    lookupRequest.input("Email", sql.NVarChar(320), email);
    lookupRequest.input("AadObjectId", sql.UniqueIdentifier, aadObjectId || null);
    lookupRequest.input("WorkOrderRowId", sql.Int, workOrderRowId);

    const lookupResult = await lookupRequest.query(`
      SET NOCOUNT ON;

      DECLARE @EmployeeProfileId UNIQUEIDENTIFIER;
      DECLARE @TimeEntryTypeId INT;
      DECLARE @WorkOrderNumber NVARCHAR(100);
      DECLARE @CustomerId UNIQUEIDENTIFIER = NULL;
      DECLARE @PropertyId INT = NULL;

      SELECT TOP 1
        @EmployeeProfileId = ep.EmployeeProfileId
      FROM dbo.EmployeeProfiles ep
      WHERE ep.IsDeleted = 0
        AND ep.IsActive = 1
        AND (
          (@AadObjectId IS NOT NULL AND ep.AadObjectId = @AadObjectId)
          OR (@Email IS NOT NULL AND LOWER(ep.Email) = LOWER(@Email))
        );

      SELECT TOP 1
        @TimeEntryTypeId = tet.TimeEntryTypeId
      FROM dbo.TimeEntryTypes tet
      WHERE tet.Code = CASE WHEN @WorkOrderRowId IS NULL THEN 'TIMECARD' ELSE 'WORKORDER' END;

      IF @WorkOrderRowId IS NOT NULL
      BEGIN
        SELECT TOP 1
          @WorkOrderNumber = COALESCE(wo.ExternalWorkOrderNumber, wo.WorkOrderNumber),
          @CustomerId = wo.CustomerId,
          @PropertyId = TRY_CAST(wo.PropertyId AS INT)
        FROM dbo.stg_WorkOrders wo
        WHERE wo.RowID = @WorkOrderRowId;
      END

      SELECT
        @EmployeeProfileId AS EmployeeProfileId,
        @TimeEntryTypeId AS TimeEntryTypeId,
        @WorkOrderNumber AS WorkOrderNumber,
        @CustomerId AS CustomerId,
        @PropertyId AS PropertyId;
    `);

    const lookup = lookupResult.recordset && lookupResult.recordset[0];

    if (!lookup || !lookup.EmployeeProfileId) {
      context.res = json(400, { ok: false, error: "EmployeeProfile not found for current user." });
      return;
    }

    if (!lookup.TimeEntryTypeId) {
      context.res = json(400, { ok: false, error: "Required TimeEntryType record not found." });
      return;
    }

    if (mode === "workorder" && !lookup.WorkOrderNumber) {
      context.res = json(400, { ok: false, error: "Work order not found." });
      return;
    }

    const insertRequest = pool.request();
    insertRequest.input("EmployeeProfileId", sql.UniqueIdentifier, lookup.EmployeeProfileId);
    insertRequest.input("TimeEntryTypeId", sql.Int, lookup.TimeEntryTypeId);
    insertRequest.input("WorkDate", sql.Date, workDate);
    insertRequest.input("StartTime", sql.DateTime2, startDateTime);
    insertRequest.input("EndTime", sql.DateTime2, endDateTime);
    insertRequest.input("BreakMinutes", sql.Int, breakMinutes);
    insertRequest.input("HoursWorked", sql.Decimal(10, 2), hoursWorked);
    insertRequest.input("IsManualHours", sql.Bit, endDateTime ? 1 : 0);
    insertRequest.input("PropertyId", sql.Int, lookup.PropertyId || null);
    insertRequest.input("CustomerId", sql.UniqueIdentifier, lookup.CustomerId || null);
    insertRequest.input("LaborType", sql.NVarChar(100), laborType);
    insertRequest.input("Notes", sql.NVarChar(2000), notes);
    insertRequest.input("WorkOrderRowId", sql.Int, workOrderRowId);
    insertRequest.input("WorkOrderNumber", sql.NVarChar(100), lookup.WorkOrderNumber || null);
    insertRequest.input("CreatedBy", sql.NVarChar(320), email || "system");

    const insertResult = await insertRequest.query(`
      SET NOCOUNT ON;

      INSERT INTO dbo.TimeEntries (
        EmployeeProfileId,
        TimeEntryTypeId,
        TimeEntryStatusId,
        WorkDate,
        StartTime,
        EndTime,
        BreakMinutes,
        HoursWorked,
        IsManualHours,
        PropertyId,
        CustomerId,
        LaborType,
        Notes,
        CreatedAt,
        CreatedBy,
        ModifiedBy,
        WorkOrderRowId,
        WorkOrderNumber,
        IsDeleted
      )
      OUTPUT
        inserted.TimeEntryId AS timeEntryId,
        inserted.WorkDate AS workDate,
        inserted.StartTime AS startTime,
        inserted.EndTime AS endTime,
        inserted.HoursWorked AS hoursWorked,
        inserted.WorkOrderRowId AS workOrderRowId,
        inserted.WorkOrderNumber AS workOrderNumber,
        inserted.Notes AS notes
      VALUES (
        @EmployeeProfileId,
        @TimeEntryTypeId,
        1,
        @WorkDate,
        @StartTime,
        @EndTime,
        @BreakMinutes,
        @HoursWorked,
        @IsManualHours,
        @PropertyId,
        @CustomerId,
        @LaborType,
        @Notes,
        SYSUTCDATETIME(),
        @CreatedBy,
        @CreatedBy,
        @WorkOrderRowId,
        @WorkOrderNumber,
        0
      );
    `);

    context.res = json(200, {
      ok: true,
      item: insertResult.recordset[0]
    });
  } catch (err) {
    context.log.error("timeentries/create error", err);
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