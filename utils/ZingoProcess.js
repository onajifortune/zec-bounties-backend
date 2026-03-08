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

    // Convert numeric values; replace NaN with null
    const num = Number(value.replace(/_/g, ""));
    result[key.replace(/['"]/g, "")] = isNaN(num) ? null : num;
  }

  // Return JSON string instead of object
  return JSON.stringify(result);
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

  rescan(command, timeout = 10000) {
    return new Promise((resolve, reject) => {
      let buffer = "";
      let resolved = false;

      const onData = (chunk) => {
        buffer += chunk.toString();
        const clean = buffer.replace(/\u001b\[[0-9;]*m/g, "");
        console.log("rescan output chunk:", clean);

        // Check if "Launching rescan..." appeared
        if (clean.includes("Launching rescan...") && !resolved) {
          resolved = true;
          // Wait 3s to let it print final status messages
          setTimeout(() => {
            resolve({ message: "Rescan launched", output: clean });
          }, 3000);
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.proc.stdout.off("data", onData);
        this.proc.stderr.off("data", onError);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Rescan command timeout"));
      }, timeout);

      this.proc.stdout.on("data", onData);
      this.proc.stderr.on("data", onError);

      this.proc.stdin.write(command + "\n");
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

  addresses(command, timeout = 10000) {
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

  balance(command, timeout = 10000) {
    return new Promise((resolve, reject) => {
      let buffer = "";

      const onData = (chunk) => {
        buffer += chunk.toString();
        const clean = buffer.replace(/\u001b\[[0-9;]*m/g, "");
        const jsonText = parseZingoBalance(clean);

        if (jsonText && jsonText !== "{}") {
          cleanup();
          resolve(JSON.parse(jsonText));
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.proc.stdout.off("data", onData);
        this.proc.stderr.off("data", onError);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Zingo command timeout"));
      }, timeout);

      this.proc.stdout.on("data", onData);
      this.proc.stderr.on("data", onError);

      this.proc.stdin.write(command + "\n");
    });
  }

  destroy() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }
}

module.exports = ZingoProcess;
