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

module.exports = async function (context, req) {
  try {
    const {
      workOrderRowId,
      photoType,
      fileName,
      contentBase64,
      caption,
      uploadedBy
    } = req.body || {};

    // ✅ Validation
    if (!workOrderRowId || !photoType || !fileName || !contentBase64) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "workOrderRowId, photoType, fileName, and contentBase64 are required." }
      };
      return;
    }

    if (!["Before", "After"].includes(photoType)) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "photoType must be 'Before' or 'After'." }
      };
      return;
    }

    // ✅ Blob setup
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
      throw new Error("Missing AZURE_STORAGE_CONNECTION_STRING");
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );

    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    // Clean filename
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const blobName = `workorders/${workOrderRowId}/${photoType.toLowerCase()}/${timestamp}-${cleanFileName}`;

    const buffer = Buffer.from(contentBase64, "base64");

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: getContentType(fileName)
      }
    });

    // ✅ Save to SQL
    const db = await getPool();

    await db.request()
      .input("WorkOrderRowId", sql.Int, parseInt(workOrderRowId, 10))
      .input("PhotoType", sql.NVarChar(20), photoType)
      .input("BlobName", sql.NVarChar(500), blobName)
      .input("FileName", sql.NVarChar(255), fileName)
      .input("Caption", sql.NVarChar(255), caption || null)
      .input("UploadedBy", sql.NVarChar(255), uploadedBy || null)
      .query(`
        INSERT INTO dbo.WorkOrderPhotos
        (
          WorkOrderRowId,
          PhotoType,
          BlobName,
          FileName,
          Caption,
          UploadedBy
        )
        VALUES
        (
          @WorkOrderRowId,
          @PhotoType,
          @BlobName,
          @FileName,
          @Caption,
          @UploadedBy
        )
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        message: "Photo uploaded successfully.",
        blobName
      }
    };

  } catch (error) {
    context.log.error("Upload error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Upload failed",
        message: error.message,
        code: error.code || null
      }
    };
  }
};

// ✅ Helper function
function getContentType(fileName) {
  const name = fileName.toLowerCase();

  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";

  return "application/octet-stream";
}
