const { PrismaClient } = require("@prisma/client");
const path = require("path");
const prisma = new PrismaClient();

/**
 * Fetch latest Zcash params for a given user.
 * Returns null if the user has no params yet (caller should run initZcashOnce).
 *
 * @param {string} ownerId
 * @returns {Promise<{ serverUrl: string, chain: string, accountName: string, dataDir: string } | null>}
 */
async function getLatestZcashParams(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");

  const params = await prisma.zcashParams.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: {
      serverUrl: true,
      chain: true, // needed for dataDir path AND for route logic
      accountName: true,
    },
  });

  if (!params) return null;

  // Path structure: wallets/{ownerId}/{accountName}/{chain}
  // This must match the path used in initZcashOnce.
  params.dataDir = path.join(
    process.cwd(),
    "wallets",
    ownerId,
    params.accountName,
    params.chain,
  );

  return params; // { serverUrl, chain, accountName, dataDir }
}

module.exports = { getLatestZcashParams };
