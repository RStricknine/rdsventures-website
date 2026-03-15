module.exports = async function (context, req) {
  const { name, phone, email, serviceType, address, details } = req.body || {};

  if (!name || !phone || !serviceType || !address || !details) {
    context.res = {
      status: 400,
      body: { message: "Missing required fields." }
    };
    return;
  }

  context.log("New service request received:", {
    name,
    phone,
    email,
    serviceType,
    address,
    details
  });

  context.res = {
    status: 200,
    body: { message: "Request received." }
  };
};
