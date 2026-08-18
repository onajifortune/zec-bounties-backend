const ZingoProcess = require("./getZingo"); // adjust path to match your project

/**
 * executeZingoParseAddress
 * Proxies to ZingoProcess.parseAddress(), which drives a running
 * zingo-cli process over stdin instead of building a shell string for
 * execSync. This removes the shell-injection surface: spawn() is called
 * with an array of args (no /bin/sh involved) in the ZingoProcess
 * constructor, and the zaddress itself is written to stdin as plain
 * text rather than concatenated into a shell command string.
 *
 * @param {string} zaddress
 * @param {object} params - { chain, serverUrl, dataDir }
 */
async function executeZingoParseAddress(zaddress, params) {
  if (!zaddress) throw new Error("No zaddress provided");

  const zingo = new ZingoProcess(params);

  try {
    const result = await zingo.parseAddress(zaddress);
    return result;
  } catch (error) {
    throw new Error(`Zingo CLI error: ${error.message}`);
  } finally {
    zingo.destroy();
  }
}

module.exports = executeZingoParseAddress;
