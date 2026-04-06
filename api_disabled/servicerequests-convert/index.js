const sql = require("mssql");
const { randomUUID } = require("crypto");

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

function addBusinessDays(startDate, businessDays) {
  const result = new Date(startDate);
  let added = 0;

  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();

    if (day !== 0 && day !== 6) {
      added++;
    }
  }

  return result;
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

    // 2. Prevent duplicate conversion
    if (sr.ConvertedToWorkOrderRowId) {
      context.res = {
        status: 400,
        body: { error: "This request has already been converted." }
      };
      return;
    }

    const conversionDate = new Date();
    const endDate = addBusinessDays(conversionDate, 3);

    let propertyId = null;
    let customerId = null;
    let contactId = null;

    // 3. Try to match property first
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
          AND (
            UPPER(LTRIM(RTRIM(Address))) = UPPER(LTRIM(RTRIM(@PropertyAddress)))
            OR UPPER(LTRIM(RTRIM(Street))) = UPPER(LTRIM(RTRIM(@PropertyAddress)))
          )
        ORDER BY PropertyId
      `);

    const property = propertyResult.recordset[0] || null;

    if (property) {
      propertyId = property.PropertyId;
      customerId = property.CustomerId;
    } else {
      // 4. If no property, try to find customer by requester name
      const customerResult = await db.request()
        .input("CustomerName", sql.NVarChar(255), sr.RequestName.trim())
        .query(`
          SELECT TOP 1
            CustomerId
          FROM dbo.Customers
          WHERE IsDeleted = 0
            AND UPPER(LTRIM(RTRIM(Name))) = UPPER(LTRIM(RTRIM(@CustomerName)))
          ORDER BY CustomerId
        `);

      const customer = customerResult.recordset[0] || null;

      if (customer) {
        customerId = customer.CustomerId;
      } else {
        const newCustomerId = randomUUID();

        await db.request()
          .input("CustomerId", sql.UniqueIdentifier, newCustomerId)
          .input("Name", sql.NVarChar(255), sr.RequestName.trim())
          .input("Phone", sql.NVarChar(50), sr.RequestPhone.trim())
          .input("Email", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
          .input("BillingStreet", sql.NVarChar(255), sr.PropertyAddress.trim())
          .input("CreatedBy", sql.NVarChar(100), "Website")
          .query(`
            INSERT INTO dbo.Customers
            (
              CustomerId,
              Name,
              Phone,
              Email,
              BillingStreet,
              IsActive,
              CreatedBy
            )
            VALUES
            (
              @CustomerId,
              @Name,
              @Phone,
              @Email,
              @BillingStreet,
              1,
              @CreatedBy
            )
          `);

        customerId = newCustomerId;
      }

      // 5. Create property if missing
      const createPropertyResult = await db.request()
        .input("CustomerId", sql.UniqueIdentifier, customerId)
        .input("Address", sql.NVarChar(255), sr.PropertyAddress.trim())
        .input("CreatedBy", sql.NVarChar(100), "Website")
        .query(`
          INSERT INTO dbo.Properties
          (
            CustomerId,
            Address,
            IsOwnerOccupied,
            IsActive,
            CreatedBy
          )
          OUTPUT INSERTED.PropertyId
          VALUES
          (
            @CustomerId,
            @Address,
            0,
            1,
            @CreatedBy
          )
        `);

      propertyId = createPropertyResult.recordset[0].PropertyId;
    }

    // 6. Create work order
    const workOrderResult = await db.request()
      .input("SourceList", sql.NVarChar(200), "Service Request")
      .input("Subject", sql.NVarChar(510), sr.ServiceType || "Service Request")
      .input("Notes", sql.NVarChar(sql.MAX), sr.Details)
      .input("Address", sql.NVarChar(510), sr.PropertyAddress)
      .input("Status", sql.NVarChar(200), "New")
      .input("Priority", sql.NVarChar(100), "Normal")
      .input("PropertyId", sql.Int, propertyId)
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("StartDate", sql.DateTime2, conversionDate)
      .input("EndDate", sql.DateTime2, endDate)
      .query(`
        INSERT INTO dbo.stg_WorkOrders
        (
          SourceList,
          Subject,
          Notes,
          Address,
          Status,
          Priority,
          PropertyId,
          CustomerId,
          StartDate,
          EndDate,
          Created
        )
        OUTPUT INSERTED.RowID
        VALUES
        (
          @SourceList,
          @Subject,
          @Notes,
          @Address,
          @Status,
          @Priority,
          @PropertyId,
          @CustomerId,
          @StartDate,
          @EndDate,
          SYSUTCDATETIME()
        )
      `);

    const rowId = workOrderResult.recordset[0].RowID;

    // 7. Find or create contact
    const contactResult = await db.request()
      .input("PropertyId", sql.Int, propertyId)
      .input("ContactName", sql.NVarChar(200), sr.RequestName.trim())
      .input("ContactEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
      .input("ContactPhone", sql.NVarChar(50), sr.RequestPhone.trim())
      .query(`
        SELECT TOP 1
          ContactId
        FROM dbo.Contacts
        WHERE PropertyId = @PropertyId
          AND IsDeleted = 0
          AND IsActive = 1
          AND (
            UPPER(LTRIM(RTRIM(ContactName))) = UPPER(LTRIM(RTRIM(@ContactName)))
            OR (@ContactEmail IS NOT NULL AND UPPER(LTRIM(RTRIM(ContactEmail))) = UPPER(LTRIM(RTRIM(@ContactEmail))))
            OR LTRIM(RTRIM(ContactPhone)) = LTRIM(RTRIM(@ContactPhone))
          )
        ORDER BY IsPrimaryContact DESC, ContactId DESC
      `);

    const existingContact = contactResult.recordset[0] || null;

    if (existingContact) {
      contactId = existingContact.ContactId;
    } else {
      const createContactResult = await db.request()
        .input("PropertyId", sql.Int, propertyId)
        .input("ContactName", sql.NVarChar(200), sr.RequestName.trim())
        .input("ContactEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
        .input("ContactPhone", sql.NVarChar(50), sr.RequestPhone.trim())
        .input("ContactType", sql.NVarChar(50), "Service Request")
        .input("CreatedBy", sql.NVarChar(100), "Website")
        .query(`
          INSERT INTO dbo.Contacts
          (
            PropertyId,
            ContactName,
            ContactEmail,
            ContactPhone,
            ContactType,
            IsPrimaryContact,
            IsActive,
            CreatedBy
          )
          OUTPUT INSERTED.ContactId
          VALUES
          (
            @PropertyId,
            @ContactName,
            @ContactEmail,
            @ContactPhone,
            @ContactType,
            1,
            1,
            @CreatedBy
          )
        `);

      contactId = createContactResult.recordset[0].ContactId;
    }

    // 8. Link work order to contact snapshot
    await db.request()
      .input("WorkOrderRowId", sql.Int, rowId)
      .input("ContactId", sql.Int, contactId)
      .input("SnapshotContactName", sql.NVarChar(200), sr.RequestName.trim())
      .input("SnapshotContactEmail", sql.NVarChar(255), sr.RequestEmail?.trim() || null)
      .input("SnapshotContactPhone", sql.NVarChar(50), sr.RequestPhone.trim())
      .input("SnapshotContactType", sql.NVarChar(50), "Service Request")
      .input("CreatedBy", sql.NVarChar(100), "Website")
      .query(`
        INSERT INTO dbo.WorkOrderContacts
        (
          WorkOrderRowId,
          ContactId,
          SnapshotContactName,
          SnapshotContactEmail,
          SnapshotContactPhone,
          SnapshotContactType,
          CreatedBy
        )
        VALUES
        (
          @WorkOrderRowId,
          @ContactId,
          @SnapshotContactName,
          @SnapshotContactEmail,
          @SnapshotContactPhone,
          @SnapshotContactType,
          @CreatedBy
        )
      `);

    // 9. Mark service request converted
    await db.request()
      .input("ServiceRequestId", sql.Int, serviceRequestId)
      .input("RowId", sql.Int, rowId)
      .query(`
        UPDATE dbo.ServiceRequests
        SET
          ConvertedToWorkOrderRowId = @RowId,
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
        propertyId,
        customerId,
        contactId
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
