const sql = require("mssql");
const { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } = require("@azure/storage-blob");

let pool;



function getSasUrl(containerName, blobName) {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

  const sharedKeyCredential = new (require("@azure/storage-blob").StorageSharedKeyCredential)(
    accountName,
    accountKey
  );

  const expiresOn = new Date(new Date().valueOf() + 60 * 60 * 1000); // 1 hour

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn
    },
    sharedKeyCredential
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}








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
    const workOrderRowId = req.query.workOrderRowId;

    if (!workOrderRowId) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "workOrderRowId is required." }
      };
      return;
    }

    const db = await getPool();

    const result = await db.request()
      .input("WorkOrderRowId", sql.Int, parseInt(workOrderRowId, 10))
      .query(`
        SELECT
          WorkOrderPhotoId,
          WorkOrderRowId,
          PhotoType,
          BlobName,
          FileName,
          Caption,
          SortOrder,
          UploadedAt,
          UploadedBy
        FROM dbo.WorkOrderPhotos
        WHERE WorkOrderRowId = @WorkOrderRowId
          AND IsActive = 1
        ORDER BY PhotoType, ISNULL(SortOrder, 999999), UploadedAt
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (error) {
    context.log.error("Work order photo list error:", error);

    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Failed to load photos",
        message: error.message,
        code: error.code || null
      }
    };
  }
};
