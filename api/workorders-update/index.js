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
    const { rowId, status, startDate, endDate, notes } = req.body || {};

    if (!rowId) {
      context.res = {
        status: 400,
        body: { error: "rowId is required." }
      };
      return;
    }

    const db = await getPool();

    await db.request()
      .input("RowID", sql.Int, rowId)
      .input("Status", sql.NVarChar(200), status || null)
      .input("StartDate", sql.DateTime2, startDate || null)
      .input("EndDate", sql.DateTime2, endDate || null)
      .input("Notes", sql.NVarChar(sql.MAX), notes || null)
      .query(`
        UPDATE dbo.stg_WorkOrders
        SET
          Status = @Status,
          StartDate = @StartDate,
          EndDate = @EndDate,
          Notes = @Notes
        WHERE RowID = @RowID
      `);

    context.res = {
      status: 200,
      body: { message: "Work order updated successfully." }
    };
  } catch (error) {
    context.log.error("Work order update error:", error);

    context.res = {
      status: 500,
      body: {
        error: "Failed to update work order",
        message: error.message
      }
    };
  }
};
