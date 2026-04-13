const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// SQLite does NOT treat two NULLs as equal in a unique index, so Prisma's
// findUnique with teamId:null (or any compound key containing null) throws.
// We always use findFirst with explicit field filters instead, then write via
// the record's integer PK where needed.
// ---------------------------------------------------------------------------

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
async function initZcashOnce(
  ownerId,
  accountName = "Main",
  chain = "mainnet",
  teamId = null,
) {
  if (!ownerId) throw new Error("ownerId is required");

  const walletDir = teamId
    ? path.join(process.cwd(), "wallets", `team:${teamId}`, accountName, chain)
    : path.join(process.cwd(), "wallets", ownerId, accountName, chain);

  fs.mkdirSync(walletDir, { recursive: true });
  console.log(`📁 Wallet directory ensured: ${walletDir}`);

  const existing = await prisma.zcashParams.findFirst({
    where: { ownerId, accountName, teamId },
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
        chain,
        ...(teamId && { teamId, isTeam: true }),
      },
    });

    console.log(`✅ Zcash initialization complete for "${accountName}"`);
    return params;
  } catch (err) {
    if (err.code === "P2002") {
      console.log(
        `⚠️ Race condition handled for "${accountName}", fetching existing record`,
      );
      return prisma.zcashParams.findFirst({
        where: { ownerId, accountName, teamId },
      });
    }
    throw err;
  }
}

/**
 * Initializes a Zcash account for a given team.
 * Creates both the DB record and the wallet directory if they don't exist.
 * Idempotent — safe to call multiple times.
 *
 * @param {string} teamId
 * @param {string} [accountName="Main"]
 * @param {string} [chain="mainnet"]  - "mainnet" or "testnet"
 * @returns {Promise<object>} The zcashParams DB record
 */
async function initZcashOnceForTeams(
  teamId,
  accountName = "Main",
  chain = "mainnet",
) {
  if (!teamId) throw new Error("teamId is required");

  // Path matches getDefaultZcashParams: wallets/team:{teamId}/{accountName}/{chain}
  const walletDir = path.join(
    process.cwd(),
    "wallets",
    `team:${teamId}`,
    accountName,
    chain,
  );
  fs.mkdirSync(walletDir, { recursive: true });
  console.log(`📁 Wallet directory ensured: ${walletDir}`);

  // teamId is non-null here, but we still use findFirst for consistency and
  // to avoid any Prisma compound-key edge cases with SQLite.
  const existing = await prisma.zcashParams.findFirst({
    where: { ownerId: teamId, accountName, teamId },
  });

  if (existing) {
    console.log(
      `✅ Zcash already initialized for team account "${accountName}"`,
    );
    return existing;
  }

  console.log(`🚀 Initializing Zcash for team account "${accountName}"`);

  try {
    const params = await prisma.zcashParams.create({
      data: {
        ownerId: teamId,
        accountName,
        chain,
        isTeam: true,
        teamId,
      },
    });

    console.log(`✅ Zcash initialization complete for team "${accountName}"`);
    return params;
  } catch (err) {
    if (err.code === "P2002") {
      console.log(
        `⚠️ Race condition handled for team "${accountName}", fetching existing record`,
      );
      return prisma.zcashParams.findFirst({
        where: { ownerId: teamId, accountName, teamId },
      });
    }
    throw err;
  }
}

module.exports = { initZcashOnce, initZcashOnceForTeams };
