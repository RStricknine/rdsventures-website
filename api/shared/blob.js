const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions
} = require("@azure/storage-blob");

const accountName = process.env.BLOB_ACCOUNT_NAME;
const accountKey = process.env.BLOB_ACCOUNT_KEY;
const containerName = process.env.BLOB_CONTAINER_NAME || "workorder-photos";

if (!accountName || !accountKey) {
  throw new Error("Missing BLOB_ACCOUNT_NAME or BLOB_ACCOUNT_KEY");
}

const credential = new StorageSharedKeyCredential(accountName, accountKey);

function getBlobServiceClient() {
  return new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );
}

function getContainerClient() {
  return getBlobServiceClient().getContainerClient(containerName);
}

function buildBlobUrl(blobName) {
  return `https://${accountName}.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}`;
}

function generateReadSas(blobName, expiresInMinutes = 30) {
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn
    },
    credential
  ).toString();

  return `${buildBlobUrl(blobName)}?${sas}`;
}

module.exports = {
  getContainerClient,
  generateReadSas,
  buildBlobUrl,
  containerName
};