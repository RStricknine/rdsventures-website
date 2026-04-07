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
    const workOrderRowId = parseInt(req.query.workOrderRowId, 10);

    if (!workOrderRowId) {
      context.res = {
        status: 400,
        body: { error: "workOrderRowId is required." }
      };
      return;
    }

    const db = await getPool();

    const result = await db.request()
      .input("WorkOrderRowId", sql.Int, workOrderRowId)
      .query(`
        SELECT
          WorkOrderNoteId,
          WorkOrderRowId,
          NoteSource,
          NoteType,
          Visibility,
          NoteText,
          CreatedAt,
          CreatedBy,
          ContactName,
          ContactPhone,
          ContactEmail
        FROM dbo.WorkOrderNotes
        WHERE WorkOrderRowId = @WorkOrderRowId
          AND IsDeleted = 0
        ORDER BY CreatedAt DESC, WorkOrderNoteId DESC;
      `);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result.recordset
    };
  } catch (err) {
    context.log.error("workorders/notes/list error", err);
    context.res = {
      status: 500,
      body: { error: err.message || "Failed to load notes." }
    };
  }
};