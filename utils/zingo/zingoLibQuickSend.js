const { getZingo } = require("./getZingo");

async function executeZingoQuickSend(recipients, params) {
  const zingo = getZingo(params);
  return await zingo.quicksend(recipients);
}

module.exports = executeZingoQuickSend;
