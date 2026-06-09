// executeZingoCliRescan.js
const { getZingo } = require("./getZingo");

async function executeZingoCliQuit(command, params) {
  const zingo = getZingo(params);
  // Quit can take minutes — use a long timeout, e.g. 10 minutes
  return await zingo.quit(command);
}

module.exports = executeZingoCliQuit;
