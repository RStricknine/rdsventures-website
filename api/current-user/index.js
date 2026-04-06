module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store"
    },
    body: "CURRENT_USER_TEST_V1"
  };
};