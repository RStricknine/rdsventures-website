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
      name,
      customerTypeId,
      email,
      phone,
      address,
      city,
      state,
      postalCode,
      isActive
    } = req.body || {};

    if (!customerId || !name || !name.trim()) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "CustomerId and Name are required." }
      };
      return;
    }

    const db = await getPool();
    
context.log("Update payload:", {
  customerId,
  name,
  customerTypeId,
  email,
  phone
});
    await db.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .input("Name", sql.NVarChar(255), name.trim())
      .input("CustomerTypeId", sql.Int, customerTypeId ? parseInt(customerTypeId, 10) : null)      
      .input("Email", sql.NVarChar(255), email?.trim() || null)
      .input("Phone", sql.NVarChar(50), phone?.trim() || null)
      .input("BillingStreet", sql.NVarChar(255), address?.trim() || null)
      .input("BillingCity", sql.NVarChar(100), city?.trim() || null)
      .input("BillingState", sql.NVarChar(50), state?.trim() || null)
      .input("BillingPostalCode", sql.NVarChar(20), postalCode?.trim() || null)
      .input("IsActive", sql.Bit, isActive ? 1 : 0)
      .query(`
        UPDATE dbo.Customers
        SET
          Name = @Name,
          CustomerTypeId = @CustomerTypeId,
          Email = @Email,
          Phone = @Phone,
          BillingStreet = @BillingStreet,
          BillingCity = @BillingCity,
          BillingState = @BillingState,
          BillingPostalCode = @BillingPostalCode,
          IsActive = @IsActive
        WHERE CustomerId = @CustomerId
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { message: "Customer updated successfully." }
    };
  } catch (error) {
    context.log.error("Update Customer API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to update customer",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
