const { getZingo } = require("./getZingo");

async function executeZingoCliRescan(command, params) {
  const zingo = getZingo(params);
  return await zingo.send(command);
}

module.exports = executeZingoCliRescan;
