const Litewallet = require("../../zingolib-wrapper/zingo_litewallet");
// const { TxBuilder, PaymentDetect } = require('./utils/utils');

// const client = new Litewallet("https://lwd6.zcash-infra.com:9067", "main", false);

// const client = new Litewallet("https://zec.rocks:443", "main", false);

let sharedClient = null;

async function getClient(options = {}) {
  const {
    server = "https://zec.rocks:443",
    chain = "main",
    readOnly = false,
  } = options;

  if (!sharedClient) {
    sharedClient = new Litewallet(server, chain, readOnly);
    await sharedClient.initAlt(
      "hole relax survey fat oppose pioneer travel recall daring fetch cave long carry peasant blanket item harvest base cycle essay protect glimpse crew absurd",
      3146400
    );
  }

  return sharedClient;
}

async function getAddress(options = {}) {
  try {
    const client = await getClient(options);
    const addresses = await client.fetchAllAddresses();
    return addresses;
  } catch (err) {
    console.log(err);
    throw err;
  }
}

/**
 * Validate if an address is a valid Zcash address
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
async function getSapplingAddress(options = {}) {
  try {
    const result = await getAddress(options);
    return result;
  } catch (error) {
    return false;
  }
}

module.exports = { getAddress, getSapplingAddress };
