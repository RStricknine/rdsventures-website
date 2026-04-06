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
      name,
      phone,
      email,
      serviceType,
      address,
      details
    } = req.body || {};

    if (!name || !phone || !address || !details) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "Name, phone, address, and details are required."
        }
      };
      return;
    }

    const db = await getPool();

    const result = await db.request()
      .input("RequestName", sql.NVarChar(200), name.trim())
      .input("RequestPhone", sql.NVarChar(50), phone.trim())
      .input("RequestEmail", sql.NVarChar(255), email?.trim() || null)
      .input("PropertyAddress", sql.NVarChar(255), address.trim())
      .input("ServiceType", sql.NVarChar(100), serviceType?.trim() || null)
      .input("Details", sql.NVarChar(sql.MAX), details.trim())
      .input("CreatedBy", sql.NVarChar(100), "Website")
      .query(`
        INSERT INTO dbo.ServiceRequests
        (
          RequestName,
          RequestPhone,
          RequestEmail,
          PropertyAddress,
          ServiceType,
          Details,
          CreatedBy
        )
        OUTPUT INSERTED.ServiceRequestId
        VALUES
        (
          @RequestName,
          @RequestPhone,
          @RequestEmail,
          @PropertyAddress,
          @ServiceType,
          @Details,
          @CreatedBy
        )
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        message: "Service request submitted successfully.",
        serviceRequestId: result.recordset[0].ServiceRequestId
      }
    };
  } catch (error) {
    context.log.error("Service request API error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to submit service request.",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
