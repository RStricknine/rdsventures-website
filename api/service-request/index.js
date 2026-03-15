const https = require("https");

function sendEmailWithSendGrid({ apiKey, from, to, subject, text, html }) {
  const data = JSON.stringify({
    personalizations: [
      {
        to: [{ email: to }],
        subject
      }
    ],
    from: { email: from },
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html }
    ]
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.sendgrid.com",
        port: 443,
        path: "/v3/mail/send",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(`SendGrid error ${res.statusCode}: ${body || "Unknown error"}`)
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function (context, req) {
  try {
    const { name, phone, email, serviceType, address, details } = req.body || {};

    if (!name || !phone || !serviceType || !address || !details) {
      context.res = {
        status: 400,
        jsonBody: { message: "Missing required fields." }
      };
      return;
    }

    const apiKey = process.env.SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const toEmail = process.env.SERVICE_REQUEST_TO_EMAIL;

    if (!apiKey || !fromEmail || !toEmail) {
      context.log.error("Missing required environment variables.");
      context.res = {
        status: 500,
        jsonBody: { message: "Server configuration is incomplete." }
      };
      return;
    }

    const safeEmail = email && email.trim() ? email.trim() : "Not provided";

    const subject = `New Service Request - ${serviceType} - ${name}`;

    const text = `
New service request received

Name: ${name}
Phone: ${phone}
Email: ${safeEmail}
Service Type: ${serviceType}
Address: ${address}

Details:
${details}
`.trim();

    const html = `
      <h2>New Service Request</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(safeEmail)}</p>
      <p><strong>Service Type:</strong> ${escapeHtml(serviceType)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Details:</strong></p>
      <p>${escapeHtml(details).replace(/\n/g, "<br>")}</p>
    `;

    await sendEmailWithSendGrid({
      apiKey,
      from: fromEmail,
      to: toEmail,
      subject,
      text,
      html
    });

    context.res = {
      status: 200,
      jsonBody: { message: "Request submitted successfully." }
    };
  } catch (error) {
    context.log.error("Service request email failed:", error.message);

    context.res = {
      status: 500,
      jsonBody: { message: "There was a problem submitting your request." }
    };
  }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
