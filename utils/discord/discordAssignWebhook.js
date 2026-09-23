const axios = require("axios");

const WEBHOOK_URL = process.env.DISCORD_BOT_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

async function notifyAssignment({ discordUsername, bountyId, bountyTitle }) {
  const payload = {
    discordUsername,
    bountyId,
    bountyTitle,
    bountyUrl: `${FRONTEND_URL}/bounty/${bountyId}`,
  };
  console.log("[discord-notify] sending payload:", JSON.stringify(payload));

  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error(
      "WEBHOOK_ENV / WEBHOOK_SECRET not set — skipping Discord assign notify",
    );
    return;
  }
  if (!discordUsername) {
    console.log("[discord-notify] skipped — no discordUsername for this user");
    return;
  }

  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { "X-Webhook-Secret": WEBHOOK_SECRET },
    });
    console.log(
      `[discord-notify] sent for ${discordUsername} (bounty ${bountyId})`,
    );
  } catch (err) {
    console.error(
      "Discord assign webhook call failed:",
      err.response?.data || err.message,
    );
  }
}

module.exports = { notifyAssignment };
