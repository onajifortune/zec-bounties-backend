const { execSync } = require("child_process");
const { existsSync } = require("fs");

function parseZingoBalance(output) {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("Launching") &&
        !l.startsWith("Save") &&
        !l.startsWith("Zingo") &&
        l !== "[" &&
        l !== "]",
    );

  const result = {};

  for (const line of lines) {
    const [key, value] = line.split(":").map((s) => s.trim());
    if (!key || !value) continue;

    // Remove numeric underscores: 190_000 → 190000
    result[key] = Number(value.replace(/_/g, ""));
  }

  return result;
}

async function executeZingoCheckBalance(command, params) {
  const zingoPath = "~/Desktop/Projects/zingolib/target/release/zingo-cli";
  const resolvedPath = zingoPath.replace(
    "~",
    process.env.HOME || "/Users/" + process.env.USER,
  );

  if (!existsSync(resolvedPath)) {
    throw new Error(`zingo-cli not found at ${resolvedPath}`);
  }

  const args = [
    `--chain ${params.chain || "mainnet"}`,
    `--server ${params.serverUrl || "http://127.0.0.1:8137"}`,
    `--data-dir ${params.dataDir || "/mnt/d/zaino/zebra/.cache/zaino"}`,
    command,
  ].join(" ");

  try {
    // Run CLI and capture output
    const rawOutput = execSync(`${resolvedPath} ${args}`, {
      stdio: "pipe",
    }).toString();

    console.log(rawOutput);

    const parsed = parseZingoBalance(rawOutput);

    return parsed;
  } catch (error) {
    throw new Error(
      `Zingo CLI error: ${error.stderr?.toString() || error.message}`,
    );
  }
}

module.exports = executeZingoCheckBalance;
