module.exports = async function (context, req) {
  context.log("DASHBOARD HIT");

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      success: true,
      message: "dashboard endpoint is alive"
    }
  };
};