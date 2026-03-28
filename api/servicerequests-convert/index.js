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
    }
  });

  return pool;
}

module.exports = async function (context, req) {
  try {
    const { serviceRequestId } = req.body || {};

    if (!serviceRequestId) {
      context.res = {
        status: 400,
        body: { error: "serviceRequestId is required." }
      };
      return;
    }

    const db = await getPool();

    // 1. Load service request
    const requestResult = await db.request()
      .input("ServiceRequestId", sql.Int, serviceRequestId)
      .query(`
        SELECT *
        FROM dbo.ServiceRequests
        WHERE ServiceRequestId = @ServiceRequestId
          AND IsDeleted = 0
      `);

    const sr = requestResult.recordset[0];

    if (!sr) {
      context.res = {
        status: 404,
        body: { error: "Service request not found." }
      };
      return;
    }

    if (sr.ConvertedToJobId) {
      context.res = {
        status: 400,
        body: { error: "This request has already been converted." }
      };
      return;
    }

    // 2. Match property by address
    const propertyResult = await db.request()
      .input("PropertyAddress", sql.NVarChar(255), sr.PropertyAddress.trim())
      .query(`
        SELECT TOP 1
          PropertyId,
          CustomerId,
          Address
        FROM dbo.Properties
        WHERE IsDeleted = 0
          AND IsActive = 1
          AND UPPER(LTRIM(RTRIM(Address))) = UPPER(LTRIM(RTRIM(@PropertyAddress)))
      `);

    const property = propertyResult.recordset[0] || null;

    const propertyId = property?.PropertyId ?? null;
    const customerId = property?.CustomerId ?? null;

    // 3. Create work order
    const workOrderResult = await db.request()
      .input("Subject", sql.NVarChar(510), sr.ServiceType || "Service Request")
      .input("Notes", sql.NVarChar(sql.MAX), sr.Details)
      .input("Address", sql.NVarChar(510), sr.PropertyAddress)
      .input("Status", sql.NVarChar(200), "New")
      .input("Priority", sql.NVarChar(100), "Normal")
      .input("PropertyId", sql.Int, propertyId)
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .query(`
        INSERT INTO dbo.stg_WorkOrders
        (
          Subject,
          Notes,
          Address,
          Status,
          Priority,
          PropertyId,
          CustomerId,
          Created
        )
        OUTPUT INSERTED.RowID
        VALUES
        (
          @Subject,
          @Notes,
          @Address,
          @Status,
          @Priority,
          @PropertyId,
          @CustomerId,
          SYSUTCDATETIME()
        )
      `);

    const rowId = workOrderResult.recordset[0].RowID;

    let tenantId = null;

    // 4. If property matched, find or create tenant
    if (propertyId) {
      const tenantResult = await db.request()
        .input("PropertyId", sql.Int, propertyId)
        .input("TenantName", sql.NVarChar(200), sr.RequestName.trim())
        .input("TenantEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
        .input("TenantPhone", sql.NVarChar(50), sr.RequestPhone.trim())
        .query(`
          SELECT TOP 1
            TenantId
          FROM dbo.Tenants
          WHERE PropertyId = @PropertyId
            AND IsDeleted = 0
            AND IsActive = 1
            AND (
              UPPER(LTRIM(RTRIM(TenantName))) = UPPER(LTRIM(RTRIM(@TenantName)))
              OR (@TenantEmail IS NOT NULL AND UPPER(LTRIM(RTRIM(TenantEmail))) = UPPER(LTRIM(RTRIM(@TenantEmail))))
              OR LTRIM(RTRIM(TenantPhone)) = LTRIM(RTRIM(@TenantPhone))
            )
          ORDER BY IsPrimaryContact DESC, TenantId DESC
        `);

      const existingTenant = tenantResult.recordset[0];

      if (existingTenant) {
        tenantId = existingTenant.TenantId;
      } else {
        const createTenantResult = await db.request()
          .input("PropertyId", sql.Int, propertyId)
          .input("TenantName", sql.NVarChar(200), sr.RequestName.trim())
          .input("TenantEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
          .input("TenantPhone", sql.NVarChar(50), sr.RequestPhone.trim())
          .input("CreatedBy", sql.NVarChar(100), "Website")
          .query(`
            INSERT INTO dbo.Tenants
            (
              PropertyId,
              TenantName,
              TenantEmail,
              TenantPhone,
              IsPrimaryContact,
              IsActive,
              CreatedBy
            )
            OUTPUT INSERTED.TenantId
            VALUES
            (
              @PropertyId,
              @TenantName,
              @TenantEmail,
              @TenantPhone,
              1,
              1,
              @CreatedBy
            )
          `);

        tenantId = createTenantResult.recordset[0].TenantId;
      }
    }

    // 5. Insert work order tenant snapshot
    await db.request()
      .input("WorkOrderRowId", sql.Int, rowId)
      .input("TenantId", sql.Int, tenantId)
      .input("SnapshotTenantName", sql.NVarChar(200), sr.RequestName.trim())
      .input("SnapshotTenantEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
      .input("SnapshotTenantPhone", sql.NVarChar(50), sr.RequestPhone.trim())
      .input("CreatedBy", sql.NVarChar(100), "Website")
      .query(`
        INSERT INTO dbo.WorkOrderTenants
        (
          WorkOrderRowId,
          TenantId,
          SnapshotTenantName,
          SnapshotTenantEmail,
          SnapshotTenantPhone,
          CreatedBy
        )
        VALUES
        (
          @WorkOrderRowId,
          @TenantId,
          @SnapshotTenantName,
          @SnapshotTenantEmail,
          @SnapshotTenantPhone,
          @CreatedBy
        )
      `);

    // 6. Mark service request converted
    await db.request()
      .input("ServiceRequestId", sql.Int, serviceRequestId)
      .input("RowId", sql.Int, rowId)
      .query(`
        UPDATE dbo.ServiceRequests
        SET
          ConvertedToJobId = @RowId,
          RequestStatus = 'Converted',
          ModifiedAt = SYSUTCDATETIME(),
          ModifiedBy = 'System'
        WHERE ServiceRequestId = @ServiceRequestId
      `);

    context.res = {
      status: 200,
      body: {
        message: "Service request converted to work order successfully.",
        workOrderRowId: rowId,
        propertyMatched: !!propertyId,
        tenantLinked: !!tenantId
      }
    };
  } catch (error) {
    context.log.error("Service request convert error:", error);

    context.res = {
      status: 500,
      body: {
        error: "Conversion failed",
        message: error.message
      }
    };
  }
};
