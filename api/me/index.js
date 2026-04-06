const { getPool } = require("../shared/db");

module.exports = async function (context, req) {
  context.res = {
    status: 200,
    body: { ok: true, hasGetPool: typeof getPool === "function" }
  };
};