// executeZingoCliRescan.js
const { getZingo } = require("./getZingo");

async function executeZingoCliRescan(command, params) {
  const zingo = getZingo(params);
  // Rescan can take minutes — use a long timeout, e.g. 10 minutes
  return await zingo.rescan(command);
}

module.exports = executeZingoCliRescan;
