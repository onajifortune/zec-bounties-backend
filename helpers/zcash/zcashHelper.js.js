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

/**
 * Fetch latest Zcash params for the authenticated client user.
 * Returns null if the user has no params yet (caller should run initZcashOnce).
 *
 * Note: This function assumes the ownerId is obtained from the authenticated session/context.
 * It does NOT include dataDir as that is server-side only.
 *
 * @param {Object} context - Authentication context (e.g., req.user, session, etc.)
 * @returns {Promise<{ serverUrl: string, chain: string, accountName: string } | null>}
 */
async function getLatestZcashParamsForClient(context) {
  // Extract ownerId from authentication context
  // Adjust this based on your auth implementation (e.g., context.user.id, context.userId, etc.)
  const ownerId = context?.user?.id || context?.userId;

  if (!ownerId) {
    throw new Error("User not authenticated");
  }

  const params = await prisma.zcashParams.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    select: {
      serverUrl: true,
      chain: true,
      accountName: true,
      // dataDir is NOT included - it's server-side only and constructed on demand
    },
  });

  return params; // { serverUrl, chain, accountName } or null
}

module.exports = { getLatestZcashParams, getLatestZcashParamsForClient };
