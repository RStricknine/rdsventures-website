const sql = require("mssql");
const { BlobServiceClient } = require("@azure/storage-blob");

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

async function deleteBlobIfExists(blobName) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  if (!connectionString || !containerName || !blobName) {
    return;
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlockBlobClient(blobName);

  await blobClient.deleteIfExists();
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
        SELECT
          WorkOrderPhotoId,
          BlobName,
          IsActive
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

    const photo = photoResult.recordset[0];

    // Try to delete the blob, but do not fail the whole request if blob delete has an issue
    try {
      await deleteBlobIfExists(photo.BlobName);
    } catch (blobError) {
      context.log.warn("Blob delete warning:", blobError.message);
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
        message: error.message,
        code: error.code || null
      }
    };
  }
};