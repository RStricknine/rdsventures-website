const sql = require("mssql");
const { randomUUID } = require("crypto");

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

    const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

    const duplicateCheck = await pool.request()
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

    await pool.request()
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
  } catch (err) {
    context.log.error("create customer error:", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: err.message || "Server error creating customer."
      }
    };
  }
};
