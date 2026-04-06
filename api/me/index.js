// inside /api/me/index.js temporarily
const { getPool } = require("../shared/db");

module.exports = async function (context, req) {
  try {
    const pool = await getPool();

    const result = await pool.request().query("SELECT GETDATE() as Now");

    context.res = {
      status: 200,
      body: result.recordset
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: err.message
    };
  }
};