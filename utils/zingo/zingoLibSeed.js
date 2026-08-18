const ZingoProcess = require("./getZingo"); // adjust path if ZingoProcess lives elsewhere

/**
 * executeZingoCliSeed
 * Imports a wallet from a seed phrase by driving a running zingo-cli
 * process over stdin (via ZingoProcess.seed), instead of building a shell
 * string and passing it to execSync. This removes the shell-injection
 * surface entirely: args to spawn() are passed as an array (no /bin/sh
 * involved), and the seed itself never appears as a CLI argument or in
 * a concatenated shell command, so it can't be observed via `ps`/`/proc`
 * and can't be used to break out into arbitrary command execution.
 *
 * @param {object} params - { chain, serverUrl, dataDir }
 * @param {string} seed - 24-word seed phrase
 * @param {number} birthday - wallet birthday height
 */
async function executeZingoCliSeed(params, seed, birthday) {
  // Reject embedded control characters (newlines/carriage returns) so a
  // crafted "word" can't inject a second command into the zingo-cli
  // stdin stream — this is a separate, narrower injection surface than
  // the OS shell, against zingo-cli's own line-based command parser.
  if (/[\r\n]/.test(seed)) {
    throw new Error("Seed phrase contains invalid characters");
  }

  const safeBirthday = Number(birthday) || 0;

  const zingo = new ZingoProcess(params);

  try {
    const result = await zingo.seed(seed, safeBirthday);
    return result;
  } catch (error) {
    throw new Error(`Zingo CLI error: ${error.message}`);
  } finally {
    zingo.destroy();
  }
}

module.exports = executeZingoCliSeed;
