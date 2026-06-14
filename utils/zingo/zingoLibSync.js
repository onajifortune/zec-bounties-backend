const { getZingo } = require("./getZingo");

async function executeZingoCliSync(command, params) {
  const zingo = getZingo(params);
  return await zingo.sync(command);
}

module.exports = executeZingoCliSync;
