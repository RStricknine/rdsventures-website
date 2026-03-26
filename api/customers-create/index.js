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
      name,
      address,
      city,
      state,
      postalCode,
      isActive
    } = req.body || {};

    if (!name || !name.trim()) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "Name is required." }
      };
      return;
    }

    const db = await getPool();

    const duplicateCheck = await db.request()
      .input("Name", sql.NVarChar(255), name.trim())
      .query(`
        SELECT TOP 1 CustomerId
        FROM dbo.Customers
        WHERE UPPER(LTRIM(RTRIM(Name))) = UPPER(LTRIM(RTRIM(@Name)))
      `);

    if (duplicateCheck.recordset.length > 0) {
      context.res = {
        status: 409,
        headers: { "Content-Type": "application/json" },
        body: { error: "A customer with that name already exists." }
      };
      return;
    }

    const customerId = randomUUID();

    await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("Name", sql.NVarChar(255), name.trim())
      .input("BillingStreet", sql.NVarChar(255), address?.trim() || null)
      .input("BillingCity", sql.NVarChar(100), city?.trim() || null)
      .input("BillingState", sql.NVarChar(50), state?.trim() || null)
      .input("BillingPostalCode", sql.NVarChar(20), postalCode?.trim() || null)
      .input("IsActive", sql.Bit, isActive ? 1 : 0)
      .query(`
        INSERT INTO dbo.Customers
        (
          CustomerId,
          Name,
          BillingStreet,
          BillingCity,
          BillingState,
          BillingPostalCode,
          IsActive
        )
        VALUES
        (
          @CustomerId,
          @Name,
          @BillingStreet,
          @BillingCity,
          @BillingState,
          @BillingPostalCode,
          @IsActive
        )
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        message: "Customer created successfully.",
        customerId
      }
    };
  } catch (error) {
    context.log.error("Create Customer API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to create customer",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
