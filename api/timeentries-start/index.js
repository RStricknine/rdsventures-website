module.exports = async function (context, req) {
  context.res = {
    status: 200,
    body: { ok: true, test: "start endpoint works" }
  };
};