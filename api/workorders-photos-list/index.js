module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: [
      {
        WorkOrderPhotoId: 1,
        WorkOrderRowId: 892,
        PhotoType: "Before",
        FileName: "test.jpg",
        Caption: "test",
        UploadedAt: new Date().toISOString(),
        UploadedBy: "system",
        ImageUrl: null
      }
    ]
  };
};