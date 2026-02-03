const ZingoProcess = require("./ZingoProcess");

/**
 * Generate a stable key for a zingo process
 */
function zingoKey({ chain, serverUrl, dataDir }) {
  return `${chain}::${serverUrl}::${dataDir}`;
}

/**
 * Zingo process pool
 * One warm process per unique (chain, serverUrl, dataDir)
 */
const pool = new Map();

function getZingo(params = {}) {
  const normalized = {
    chain: params.chain || "mainnet",
    serverUrl: params.serverUrl || "http://127.0.0.1:8137",
    dataDir: params.dataDir || "/mnt/d/zaino/zebra/.cache/zaino",
  };

  const key = zingoKey(normalized);

  // Reuse if exists
  if (pool.has(key)) {
    return pool.get(key);
  }

  // Spawn new warm process
  const zingo = new ZingoProcess(normalized);

  pool.set(key, zingo);

  // Auto-cleanup if process exits
  zingo.proc.on("exit", () => {
    pool.delete(key);
  });

  return zingo;
}

function invalidateZingo(params) {
  const key = zingoKey(params);
  const proc = pool.get(key);

  if (proc) {
    proc.destroy();
    pool.delete(key);
  }
}

module.exports = {
  getZingo,
  invalidateZingo,
};
