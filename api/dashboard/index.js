module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: {
      customers: 124,
      properties: 387,
      openWorkOrders: 19,
      recentActivity: [
        "New customer added: ABC Property Management",
        "Property imported: 1701 Running Brook Road",
        "Work order #4821 marked complete"
      ]
    }
  };
};
