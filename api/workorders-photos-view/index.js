const sql = require("mssql");
const {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} = require("@azure/storage-blob");

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
    const workOrderPhotoId = parseInt(
      req.query.workOrderPhotoId || req.params.workOrderPhotoId,
      10
    );

    if (!workOrderPhotoId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "workOrderPhotoId is required." }
      };
      return;
    }

    const db = await getPool();

    const result = await db
      .request()
      .input("WorkOrderPhotoId", sql.Int, workOrderPhotoId)
      .query(`
        SELECT TOP 1 BlobName
        FROM dbo.WorkOrderPhotos
        WHERE WorkOrderPhotoId = @WorkOrderPhotoId
      `);

    const photo = result.recordset[0];

    if (!photo || !photo.BlobName) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { error: "Photo not found." }
      };
      return;
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "workorder-photos";

    if (!accountName || !accountKey) {
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { error: "Storage account configuration missing." }
      };
      return;
    }

    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

    const expiresOn = new Date(Date.now() + 15 * 60 * 1000);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName,
        blobName: photo.BlobName,
        permissions: BlobSASPermissions.parse("r"),
        expiresOn
      },
      sharedKeyCredential
    ).toString();

    const blobUrl = `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(photo.BlobName).replace(/%2F/g, "/")}?${sasToken}`;

    context.res = {
      status: 302,
      headers: {
        Location: blobUrl,
        "Cache-Control": "no-store"
      }
    };
  } catch (err) {
    context.log.error("PHOTO VIEW ERROR:", err);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load photo.",
        message: err.message
      }
    };
  }
};