const transporter = require("./mailer");

const isProd = process.env.NODE_ENV === "production";

async function sendMail({ to, subject, text, html }) {
  // DEV OVERRIDE LOGIC
  const finalTo = isProd ? to : process.env.DEV_EMAIL_FALLBACK || to;

  const info = await transporter.sendMail({
    from: `"ZEC Alerts" <${process.env.SMTP_USER}>`,
    to: finalTo,
    subject: isProd ? subject : `[DEV] ${subject}`,
    text,
    html,
  });

  console.log("MAIL INFO:", {
    response: info.response,
  });

  return info;
}

module.exports = sendMail;
