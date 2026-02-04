const { spawn } = require("child_process");
const { existsSync } = require("fs");

function extractJson(text) {
  let start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;

  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null; // incomplete JSON
}

class ZingoProcess {
  constructor(params = {}) {
    this.zingoPath = process.env.ZINGO_CLI;

    if (!existsSync(this.zingoPath)) {
      throw new Error(`zingo-cli not found at ${this.zingoPath}`);
    }

    const args = [
      "--chain",
      params.chain || "mainnet",
      "--server",
      params.serverUrl || "http://127.0.0.1:8137",
      "--data-dir",
      params.dataDir || "/mnt/d/zaino/zebra/.cache/zaino",
    ];

    this.proc = spawn(this.zingoPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.buffer = "";
    this.waiters = [];

    this.proc.stdout.on("data", (data) => {
      const text = data.toString();
      this.buffer += text;

      // Resolve any pending command waiting for output
      this.waiters.forEach((w) => w());
    });

    this.proc.stderr.on("data", (data) => {
      console.error("ZINGO STDERR:", data.toString());
    });

    this.proc.on("exit", (code) => {
      console.error("Zingo exited with code", code);
    });
  }

  send(command, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startBufferLen = this.buffer.length;

      this.proc.stdin.write(command + "\n");

      const check = () => {
        const chunk = this.buffer.slice(startBufferLen);
        console.log("chunk", chunk);

        // Remove ANSI
        const clean = chunk.replace(/\u001b\[[0-9;]*m/g, "");

        const jsonText = extractJson(clean);
        if (jsonText) {
          try {
            resolve(JSON.parse(jsonText));
          } catch (e) {
            reject(e);
          }
          return true;
        }
        return false;
      };

      const interval = setInterval(() => {
        if (check()) {
          clearInterval(interval);
          clearTimeout(timer);
        }
      }, 50);

      const timer = setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Zingo command timeout"));
      }, timeout);

      this.waiters.push(() => {
        if (check()) {
          clearInterval(interval);
          clearTimeout(timer);
        }
      });
    });
  }

  destroy() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }
}

module.exports = ZingoProcess;
