const { getZingo } = require("./getZingo");

async function executeZingoCliBalance(command, params) {
  const zingo = getZingo(params);
  const result = await zingo.balance(command);
  console.log("Rezzy", result);
  return result;
}

module.exports = executeZingoCliBalance;
