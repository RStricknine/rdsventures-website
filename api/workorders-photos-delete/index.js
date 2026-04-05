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
    const { workOrderPhotoId } = req.body || {};

    if (!workOrderPhotoId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "workOrderPhotoId is required." }
      };
      return;
    }

    const db = await getPool();

    const photoResult = await db.request()
      .input("WorkOrderPhotoId", sql.Int, parseInt(workOrderPhotoId, 10))
      .query(`
        SELECT WorkOrderPhotoId
        FROM dbo.WorkOrderPhotos
        WHERE WorkOrderPhotoId = @WorkOrderPhotoId
      `);

    if (!photoResult.recordset.length) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Photo not found." }
      };
      return;
    }

    await db.request()
      .input("WorkOrderPhotoId", sql.Int, parseInt(workOrderPhotoId, 10))
      .query(`
        UPDATE dbo.WorkOrderPhotos
        SET IsActive = 0
        WHERE WorkOrderPhotoId = @WorkOrderPhotoId
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { message: "Photo deleted successfully." }
    };
  } catch (error) {
    context.log.error("Work order photo delete error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to delete photo",
        message: error.message
      }
    };
  }
};