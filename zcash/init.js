const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const prisma = new PrismaClient();

/**
 * Initializes a Zcash account for a given owner.
 * Creates both the DB record and the wallet directory if they don't exist.
 * Idempotent — safe to call multiple times.
 *
 * @param {string} ownerId
 * @param {string} [accountName="Main"]
 * @param {string} [chain="mainnet"]  - "mainnet" or "testnet"
 * @returns {Promise<object>} The zcashParams DB record
 */
async function initZcashOnce(ownerId, accountName = "Main", chain = "mainnet") {
  if (!ownerId) throw new Error("ownerId is required");

  // Always ensure the wallet directory exists, regardless of DB state.
  // This is cheap (mkdirSync with recursive) and prevents a missing dir
  // if the process crashed between DB insert and mkdir last time.
  const walletDir = path.join(
    process.cwd(),
    "wallets",
    ownerId,
    accountName,
    chain,
  );
  fs.mkdirSync(walletDir, { recursive: true });
  console.log(`📁 Wallet directory ensured: ${walletDir}`);

  // Check if DB record already exists
  const existing = await prisma.zcashParams.findUnique({
    where: {
      ownerId_accountName: {
        ownerId,
        accountName,
      },
    },
  });

  if (existing) {
    console.log(`✅ Zcash already initialized for account "${accountName}"`);
    return existing;
  }

  console.log(`🚀 Initializing Zcash for account "${accountName}"`);

  try {
    const params = await prisma.zcashParams.create({
      data: {
        ownerId,
        accountName,
        chain, // store the chain so getLatestZcashParams can use it
      },
    });

    console.log(`✅ Zcash initialization complete for "${accountName}"`);
    return params;
  } catch (err) {
    // P2002 = unique constraint violation (race condition: another request
    // created the record between our findUnique and create). Just return it.
    if (err.code === "P2002") {
      console.log(
        `⚠️ Race condition handled for "${accountName}", fetching existing record`,
      );
      return prisma.zcashParams.findUnique({
        where: {
          ownerId_accountName: {
            ownerId,
            accountName,
          },
        },
      });
    }
    throw err;
  }
}

module.exports = { initZcashOnce };
