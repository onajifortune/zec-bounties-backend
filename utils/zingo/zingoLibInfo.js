// executeZingoCliInfo.js
const { getZingo } = require("./getZingo");

async function executeZingoCliInfo(command, params) {
  const zingo = getZingo(params);
  return await zingo.info(command);
}

module.exports = executeZingoCliInfo;
