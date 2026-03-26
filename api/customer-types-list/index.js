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
    options: { encrypt: true }
  });

  return pool;
}

module.exports = async function (context) {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT CustomerTypeId, TypeName
      FROM dbo.CustomerType
      ORDER BY TypeName
    `);

    context.res = {
      status: 200,
      body: result.recordset
    };
  } catch (err) {
    context.res = { status: 500, body: err.message };
  }
};
