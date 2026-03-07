// executeZingoCliRescan.js
const { getZingo } = require("./getZingo");

async function executeZingoCliRescan(command, params) {
  const zingo = getZingo(params);
  // Rescan can take minutes — use a long timeout, e.g. 10 minutes
  return await zingo.send(command, 15 * 1000);
}

module.exports = executeZingoCliRescan;
