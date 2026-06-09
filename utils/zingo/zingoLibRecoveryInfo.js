// executeZingoCliRecoveryInfo.js
const { getZingo } = require("./getZingo");

async function executeZingoCliRecoveryInfo(command, params) {
  const zingo = getZingo(params);
  return await zingo.recovery_info(command);
}

module.exports = executeZingoCliRecoveryInfo;
