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

module.exports = async function (context, req) {
  try {
    const {
      customerId,
      propertyId,
      externalWorkOrderNumber,
      subject,
      status,
      priority,
      startDate,
      endDate,
      notes
    } = req.body || {};

    if (!customerId) {
      context.res = { status: 400, body: { error: "customerId is required." } };
      return;
    }

    if (!propertyId) {
      context.res = { status: 400, body: { error: "propertyId is required." } };
      return;
    }

    if (!subject) {
      context.res = { status: 400, body: { error: "subject is required." } };
      return;
    }

    const db = await getPool();

    const propertyResult = await db.request()
      .input("PropertyId", sql.Int, parseInt(propertyId, 10))
      .query(`
        SELECT PropertyId, CustomerId, Address, Street, City, State, PostalCode
        FROM dbo.Properties
        WHERE PropertyId = @PropertyId
          AND IsDeleted = 0
      `);

    const property = propertyResult.recordset[0];

    if (!property) {
      context.res = { status: 404, body: { error: "Property not found." } };
      return;
    }

    const result = await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("PropertyId", sql.Int, parseInt(propertyId, 10))
      .input("Address", sql.NVarChar(255), property.Address || null)
      .input("Street", sql.NVarChar(255), property.Street || null)
      .input("City", sql.NVarChar(100), property.City || null)
      .input("State", sql.NVarChar(2), property.State || null)
      .input("PostalCode", sql.NVarChar(20), property.PostalCode || null)
      .input("Subject", sql.NVarChar(sql.MAX), subject)
      .input("Status", sql.NVarChar(100), status || "New")
      .input("Priority", sql.NVarChar(100), priority || "Medium")
      .input("StartDate", sql.DateTime2, startDate || null)
      .input("EndDate", sql.DateTime2, endDate || null)
      .input("Notes", sql.NVarChar(sql.MAX), notes || null)
      .query(`
        INSERT INTO dbo.stg_WorkOrders
        (
          CustomerId,
          PropertyId,
          Address,
          Street,
          City,
          State,
          PostalCode,
          Subject,
          Status,
          Priority,
          StartDate,
          EndDate,
          Notes,
          Created
        )
        OUTPUT INSERTED.RowID
        VALUES
        (
          @CustomerId,
          @PropertyId,
          @Address,
          @Street,
          @City,
          @State,
          @PostalCode,
          @Subject,
          @Status,
          @Priority,
          @StartDate,
          @EndDate,
          @Notes,
          SYSUTCDATETIME()
        )
      `);

    context.res = {
      status: 200,
      body: {
        message: "Work order created successfully.",
        rowId: result.recordset[0].RowID
      }
    };
  } catch (error) {
    context.log.error("Work order create error:", error);

    context.res = {
      status: 500,
      body: {
        error: "Failed to create work order",
        message: error.message
      }
    };
  }
};
