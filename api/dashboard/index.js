module.exports = async function (context, req) {
  context.log("FUNCTION HIT");

  try {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        ok: true,
        message: "function is running"
      }
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: {
        error: err.message
      }
    };
  }
};