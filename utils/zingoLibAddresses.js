const { getZingo } = require("./getZingo");

async function executeZingoCliAddresses(command, params) {
  const zingo = getZingo(params);
  return await zingo.addresses(command);
}

module.exports = executeZingoCliAddresses;
