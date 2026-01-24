const Litewallet = require("../../zingolib-wrapper/zingo_litewallet");

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

async function parseZcashAddressT(address, options = {}) {
  try {
    const client = await getClient(options);
    const addr = await client.parseAddress(address);
    return addr;
  } catch (err) {
    console.log(err);
    throw err;
  }
}

/**
 * Parse a Zcash address to get its details
 * @param {string} address - The Zcash address to parse (UA, z-addr, or t-addr)
 * @param {Object} options - Configuration options
 * @param {string} options.server - The lightwalletd server URL (default: mainnet)
 * @param {string} options.chain - The chain to use: "main" or "test" (default: "main")
 * @param {boolean} options.readOnly - Whether to use read-only mode (default: false)
 * @returns {Promise<Object|null>} Parsed address object or null if invalid
 * @throws {Error} If initialization or parsing fails
 */
async function parseZcashAddress(address, options = {}) {
  const {
    server = "https://zec.rocks:443",
    chain = "main",
    readOnly = false,
  } = options;

  const client = new Litewallet(server, chain, readOnly);

  return client
    .init()
    .then(async () => {
      let addr = await client.parseAddress(address);
      console.log(addr);

      client.deinitialize();
      return addr;
    })
    .catch((err) => console.log(err));
}

/**
 * Validate if an address is a valid Zcash address
 * @param {string} address - The address to validate
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
async function isValidZcashAddress(address, options = {}) {
  try {
    const result = await parseZcashAddress(address, options);
    return result !== null && !result.error;
  } catch (error) {
    return false;
  }
}

/**
 * Validate if an address is a valid Zcash address
 * @param {string} address - The address to validate
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
async function isSaplingZcashAddress(address, options = {}) {
  console.log(address);
  try {
    const result = await parseZcashAddressT(address, options);
    console.log("Result", result);
    return result !== null && result.address_kind === "sapling";
  } catch (error) {
    return false;
  }
}

module.exports = {
  parseZcashAddress,
  isValidZcashAddress,
  isSaplingZcashAddress,
  parseZcashAddressT,
};
