module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: {
      customers: 123,
      properties: 888,
      openWorkOrders: 777,
      newRequests: 666,
      recentActivity: [
        "TEST DEPLOYMENT WORKED"
      ]
    }
  };
};
