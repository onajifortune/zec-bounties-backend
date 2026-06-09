const { getZingo } = require("./getZingo");

async function executeZingoCliTransactions(params) {
  const zingo = getZingo(params);
  return await zingo.transactions();
}

module.exports = executeZingoCliTransactions;
