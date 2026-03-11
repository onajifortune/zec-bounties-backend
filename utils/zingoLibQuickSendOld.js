const { execSync } = require("child_process");
const { existsSync } = require("fs");

async function executeZingoQuickSend(recipients, params) {
  const command = "quicksend";

  const zingoPath = process.env.ZINGO_CLI;

  if (!existsSync(zingoPath)) {
    throw new Error(`zingo-cli not found at ${zingoPath}`);
  }

  // 📝 Ensure each recipient has amount in zatoshis and default memo
  const sanitizedRecipients = recipients.map((r) => ({
    address: r.address,
    amount: Math.ceil(Number(r.amount)), // already in zatoshis
    memo: r.memo || "Sent from the ZEC bounty app!", // default memo
  }));

  // Build JSON string exactly as CLI expects
  const jsonString = JSON.stringify(sanitizedRecipients);

  const args = [
    `--chain ${params.chain || "mainnet"}`,
    `--server ${params.serverUrl || "http://127.0.0.1:8137"}`,
    `--data-dir ${params.dataDir || "/mnt/d/zaino/zebra/.cache/zaino"}`,
    command,
    `'${jsonString}'`,
  ].join(" ");

  console.log(args);

  try {
    // 1️⃣ Run CLI and capture full output
    const rawOutput = execSync(`${zingoPath} ${args}`, {
      stdio: "pipe",
    }).toString();

    console.log(rawOutput);

    // 2️⃣ Strip ANSI color codes
    const noAnsi = rawOutput.replace(/\u001b\[[0-9;]*m/g, "");

    // 3️⃣ Extract JSON blocks (any {…} including newlines)
    const jsonBlocks = noAnsi.match(/\{[\s\S]*?\}/g) || [];

    // 4️⃣ Parse each JSON block safely
    const parsed = jsonBlocks
      .map((block) => {
        try {
          return JSON.parse(block);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // 5️⃣ Return array if >1 objects, or object if just 1
    if (parsed.length === 1) return parsed[0];
    return parsed;
  } catch (error) {
    throw new Error(
      `Zingo CLI error: ${error.stderr?.toString() || error.message}`,
    );
  }
}

module.exports = executeZingoQuickSend;
