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
    const body = req.body || {};

    const workOrderRowId = parseInt(body.workOrderRowId, 10);
    const noteSource = String(body.noteSource || "").trim();
    const noteType = String(body.noteType || "").trim();
    const noteText = String(body.noteText || "").trim();
    const visibility = String(body.visibility || "Internal").trim();
    const createdBy = String(body.createdBy || "dashboard-user").trim();
    const contactName = body.contactName ? String(body.contactName).trim() : null;
    const contactPhone = body.contactPhone ? String(body.contactPhone).trim() : null;
    const contactEmail = body.contactEmail ? String(body.contactEmail).trim() : null;

    if (!workOrderRowId) {
      context.res = { status: 400, body: { error: "workOrderRowId is required." } };
      return;
    }

    if (!noteSource) {
      context.res = { status: 400, body: { error: "noteSource is required." } };
      return;
    }

    if (!noteType) {
      context.res = { status: 400, body: { error: "noteType is required." } };
      return;
    }

    if (!noteText) {
      context.res = { status: 400, body: { error: "noteText is required." } };
      return;
    }

    const db = await getPool();
        context.log("notes/create body:", req.body);
        context.log("notes/create values:", {
        workOrderRowId,
        noteSource,
        noteType,
        visibility,
        noteText,
        createdBy,
        contactName,
        contactPhone,
        contactEmail
        });
        
    const result = await db.request()
      .input("WorkOrderRowId", sql.Int, workOrderRowId)
      .input("NoteSource", sql.NVarChar(50), noteSource)
      .input("NoteType", sql.NVarChar(50), noteType)
      .input("Visibility", sql.NVarChar(50), visibility)
      .input("NoteText", sql.NVarChar(sql.MAX), noteText)
      .input("CreatedBy", sql.NVarChar(100), createdBy)
      .input("ContactName", sql.NVarChar(200), contactName)
      .input("ContactPhone", sql.NVarChar(50), contactPhone)
      .input("ContactEmail", sql.NVarChar(255), contactEmail)
      .query(`
        INSERT INTO dbo.WorkOrderNotes (
          WorkOrderRowId,
          NoteSource,
          NoteType,
          Visibility,
          NoteText,
          CreatedBy,
          ContactName,
          ContactPhone,
          ContactEmail
        )
        OUTPUT
          inserted.WorkOrderNoteId,
          inserted.WorkOrderRowId,
          inserted.NoteSource,
          inserted.NoteType,
          inserted.Visibility,
          inserted.NoteText,
          inserted.CreatedAt,
          inserted.CreatedBy,
          inserted.ContactName,
          inserted.ContactPhone,
          inserted.ContactEmail
        VALUES (
          @WorkOrderRowId,
          @NoteSource,
          @NoteType,
          @Visibility,
          @NoteText,
          @CreatedBy,
          @ContactName,
          @ContactPhone,
          @ContactEmail
        );
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset[0]
    };
  } catch (err) {
    context.log.error("workorders/notes/create error", err);
    context.res = {
      status: 500,
      body: { error: err.message || "Failed to create note." }
    };
  }
};