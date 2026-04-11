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

function safeDecimalHours(startTime, endTime, breakMinutes) {
  if (!startTime || !endTime) return 0;

  const [sh, sm] = String(startTime).split(":").map(Number);
  const [eh, em] = String(endTime).split(":").map(Number);

  if (
    Number.isNaN(sh) || Number.isNaN(sm) ||
    Number.isNaN(eh) || Number.isNaN(em)
  ) {
    return 0;
  }

  const startMinutes = (sh * 60) + sm;
  const endMinutes = (eh * 60) + em;

  const diffMinutes = endMinutes - startMinutes;
  if (diffMinutes <= 0) return 0;

  const totalHours = (diffMinutes - Number(breakMinutes || 0)) / 60;
  return totalHours > 0 ? Number(totalHours.toFixed(2)) : 0;
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

    const hoursWorked = safeDecimalHours(startTime, endTime, breakMinutes);

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
      WHERE ep.IsActive = 1
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
    insertRequest.input("StartTimeText", sql.NVarChar(5), startTime);
    insertRequest.input("EndTimeText", sql.NVarChar(5), endTime);
    insertRequest.input("BreakMinutes", sql.Int, breakMinutes);
    insertRequest.input("HoursWorked", sql.Decimal(10, 2), hoursWorked);
    insertRequest.input("IsManualHours", sql.Bit, endTime ? 1 : 0);
    insertRequest.input("PropertyId", sql.Int, lookup.PropertyId || null);
    insertRequest.input("CustomerId", sql.UniqueIdentifier, lookup.CustomerId || null);
    insertRequest.input("LaborType", sql.NVarChar(100), laborType);
    insertRequest.input("Notes", sql.NVarChar(2000), notes);
    insertRequest.input("WorkOrderRowId", sql.Int, workOrderRowId);
    insertRequest.input("WorkOrderNumber", sql.NVarChar(100), lookup.WorkOrderNumber || null);
    insertRequest.input("CreatedBy", sql.NVarChar(320), email || "system");

    const insertResult = await insertRequest.query(`
      SET NOCOUNT ON;

      DECLARE @Inserted TABLE (
        timeEntryId UNIQUEIDENTIFIER,
        workDate DATE,
        startTime DATETIME2,
        endTime DATETIME2,
        hoursWorked DECIMAL(10,2),
        workOrderRowId INT,
        workOrderNumber NVARCHAR(100),
        notes NVARCHAR(2000)
      );

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
        WorkOrderNumber
      )
      OUTPUT
        inserted.TimeEntryId,
        inserted.WorkDate,
        inserted.StartTime,
        inserted.EndTime,
        inserted.HoursWorked,
        inserted.WorkOrderRowId,
        inserted.WorkOrderNumber,
        inserted.Notes
      INTO @Inserted (
        timeEntryId,
        workDate,
        startTime,
        endTime,
        hoursWorked,
        workOrderRowId,
        workOrderNumber,
        notes
      )
      VALUES (
        @EmployeeProfileId,
        @TimeEntryTypeId,
        1,
        @WorkDate,
        CASE
          WHEN @StartTimeText IS NULL OR @StartTimeText = '' THEN NULL
          ELSE CAST(CONCAT(CONVERT(varchar(10), @WorkDate, 23), 'T', @StartTimeText, ':00') AS DATETIME2)
        END,
        CASE
          WHEN @EndTimeText IS NULL OR @EndTimeText = '' THEN NULL
          ELSE CAST(CONCAT(CONVERT(varchar(10), @WorkDate, 23), 'T', @EndTimeText, ':00') AS DATETIME2)
        END,
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
        @WorkOrderNumber
      );

      SELECT
        timeEntryId,
        workDate,
        startTime,
        endTime,
        hoursWorked,
        workOrderRowId,
        workOrderNumber,
        notes
      FROM @Inserted;
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