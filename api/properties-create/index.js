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
      street,
      city,
      state,
      postalCode,
      lockbox
    } = req.body || {};

    if (!customerId) {
      context.res = {
        status: 400,
        body: { error: "customerId is required." }
      };
      return;
    }

    if (!street || !city || !state || !postalCode) {
      context.res = {
        status: 400,
        body: { error: "street, city, state, and postalCode are required." }
      };
      return;
    }

    const address = `${street} ${city} ${state} ${postalCode}`;
    const db = await getPool();

    const existing = await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("Street", sql.NVarChar(255), street)
      .input("City", sql.NVarChar(100), city)
      .input("State", sql.NVarChar(2), state)
      .input("PostalCode", sql.NVarChar(20), postalCode)
      .query(`
        SELECT TOP 1 PropertyId
        FROM dbo.Properties
        WHERE CustomerId = @CustomerId
          AND Street = @Street
          AND City = @City
          AND State = @State
          AND PostalCode = @PostalCode
          AND IsDeleted = 0
      `);

    if (existing.recordset.length) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          message: "Property already exists.",
          propertyId: existing.recordset[0].PropertyId
        }
      };
      return;
    }

    const result = await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("Address", sql.NVarChar(255), address)
      .input("Street", sql.NVarChar(255), street)
      .input("City", sql.NVarChar(100), city)
      .input("State", sql.NVarChar(2), state)
      .input("PostalCode", sql.NVarChar(20), postalCode)
      .input("Lockbox", sql.NVarChar(100), lockbox || null)
      .input("CreatedBy", sql.NVarChar(100), "dashboard-user")
      .query(`
        INSERT INTO dbo.Properties
        (
          CustomerId,
          Address,
          Street,
          City,
          State,
          PostalCode,
          Lockbox,
          IsOwnerOccupied,
          IsActive,
          CreatedAt,
          CreatedBy,
          IsDeleted
        )
        OUTPUT INSERTED.PropertyId
        VALUES
        (
          @CustomerId,
          @Address,
          @Street,
          @City,
          @State,
          @PostalCode,
          @Lockbox,
          0,
          1,
          SYSUTCDATETIME(),
          @CreatedBy,
          0
        )
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        message: "Property created successfully.",
        propertyId: result.recordset[0].PropertyId
      }
    };
  } catch (error) {
    context.log.error("Property create error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to create property",
        message: error.message
      }
    };
  }
};
