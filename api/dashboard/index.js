module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      ok: true,
      env: {
        SQL_SERVER: !!process.env.SQL_SERVER,
        SQL_DATABASE: !!process.env.SQL_DATABASE,
        SQL_USER: !!process.env.SQL_USER,
        SQL_PASSWORD: !!process.env.SQL_PASSWORD,
        SQL_PORT: process.env.SQL_PORT || null
      }
    }
  };
};