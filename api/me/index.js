module.exports = async function (context, req) {
  try {
    context.res = {
      status: 200,
      body: {
        ok: true,
        message: "me function loaded"
      }
    };
  } catch (err) {
    context.res = {
      status: 500,
      body: {
        error: err.message,
        stack: err.stack
      }
    };
  }
};