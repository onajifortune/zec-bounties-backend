const WEBHOOK_URL = process.env.DISCORD_BOT_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

async function notifyDiscordAssignment({
  discordUsername,
  bountyId,
  bountyTitle,
}) {
  console.log("response", discordUsername);
  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error(
      "Discord webhook not configured: missing DISCORD_BOT_WEBHOOK_URL or WEBHOOK_SECRET",
    );
    return;
  }

  const response = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": WEBHOOK_SECRET,
    },
    body: JSON.stringify({ discordUsername, bountyId, bountyTitle }),
  });

  console.log("response", response);

  if (!response.ok) {
    throw new Error(
      `Discord webhook call failed with status ${response.status}`,
    );
  }
}

module.exports = { notifyDiscordAssignment };
