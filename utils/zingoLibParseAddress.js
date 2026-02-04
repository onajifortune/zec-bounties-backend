const { execSync } = require("child_process");
const { existsSync } = require("fs");

async function executeZingoParseAddress(zaddress, params) {
  const command = "parse_address";
  if (!zaddress) throw new Error("No zaddress provided");

  const zingoPath = process.env.ZINGO_CLI;

  if (!existsSync(zingoPath)) {
    throw new Error(`zingo-cli not found at ${resolvedPath}`);
  }

  const args = [
    `--chain ${"testnet"}`,
    `--server ${" https://testnet.zec.rocks:443 "}`,
    `--data-dir ${"/Users/sntjq/Desktop/Projects/zec-bounties/bounty-backend/wallets/cmhyplsud0002sbg4q2po7uh1/Test1/testnet"}`,
    command,
    zaddress,
  ].join(" ");

  console.log(args);

  try {
    // 1️⃣ Run CLI and capture full output
    const rawOutput = execSync(`${resolvedPath} ${args}`, {
      stdio: "pipe",
    }).toString();

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
    console.log("resultz", parsed);
    if (parsed.length === 1) return parsed[0];
    return parsed;
  } catch (error) {
    throw new Error(
      `Zingo CLI error: ${error.stderr?.toString() || error.message}`,
    );
  }
}

module.exports = executeZingoParseAddress;
