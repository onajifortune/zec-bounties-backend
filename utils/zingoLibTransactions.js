const { execSync } = require("child_process");
const { existsSync } = require("fs");

// function extractJsonBlock(output) {
//   const match = output.match(
//     /\{[\s\S]*?\}\s*(?=Save task shutdown successfully\.)/,
//   );
//   if (!match) return null;

//   const block = match[0];

//   const stack = [{}];
//   let current = stack[0];

//   const lines = block
//     .split("\n")
//     .map((l) => l.trim())
//     .filter((l) => l && l !== "{");

//   for (const line of lines) {
//     if (line === "}") {
//       stack.pop();
//       current = stack[stack.length - 1];
//       continue;
//     }

//     const m = line.match(/^(.+?):\s*(.*)$/);
//     if (!m) continue;

//     const key = m[1].trim();
//     const rawValue = m[2].trim();

//     if (rawValue === "") {
//       const obj = {};
//       current[key] = obj;
//       stack.push(obj);
//       current = obj;
//     } else {
//       current[key] = /^\d+(\.\d+)?$/.test(rawValue)
//         ? Number(rawValue)
//         : rawValue;
//     }
//   }

//   return stack[0];
// }

function extractTransactions(output) {
  // Match ALL top-level {...} blocks
  const blocks = output.match(/\{\n[\s\S]*?\n\}/g);
  if (!blocks) return [];

  return blocks.map(parseZingoBlock);
}

function parseZingoBlock(block) {
  const root = {};
  const stack = [{ obj: root, key: null }];

  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1, -1); // remove outer { }

  for (const line of lines) {
    if (line === "{") {
      const parent = stack[stack.length - 1];
      const key = parent.key;

      if (!Array.isArray(parent.obj[key])) {
        parent.obj[key] = parent.obj[key] ? [parent.obj[key]] : [];
      }

      const obj = {};
      parent.obj[key].push(obj);
      stack.push({ obj, key: null });
      continue;
    }

    if (line === "}") {
      stack.pop();
      continue;
    }

    const m = line.match(/^(.+?):\s*(.*)$/);
    if (!m) continue;

    const key = m[1].trim();
    const raw = m[2].trim();
    const current = stack[stack.length - 1];

    if (raw === "") {
      current.key = key;
      current.obj[key] = current.obj[key] || {};
    } else {
      current.obj[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
    }
  }

  return root;
}

async function executeZingoCliTransactions(command, params) {
  const zingoPath = process.env.ZINGO_CLI;

  if (!existsSync(zingoPath)) {
    throw new Error(`zingo-cli not found at ${zingoPath}`);
  }

  const args = [
    `--chain ${params.chain || "mainnet"}`,
    `--server ${params.serverUrl || "http://127.0.0.1:8137"}`,
    `--data-dir ${params.dataDir || "/mnt/d/zaino/zebra/.cache/zaino"}`,
    command,
  ].join(" ");

  console.log(args);

  try {
    // 1️⃣ Run CLI and capture full output
    const rawOutput = execSync(`${zingoPath} ${args}`, {
      stdio: "pipe",
    }).toString();

    // 4️⃣ Parse each JSON block safely
    const parsed = extractTransactions(rawOutput);
    // 5️⃣ Return array if >1 objects, or object if just 1
    if (parsed.length === 1) return parsed[0];
    return parsed;
  } catch (error) {
    throw new Error(
      `Zingo CLI error: ${error.stderr?.toString() || error.message}`,
    );
  }
}

module.exports = executeZingoCliTransactions;
