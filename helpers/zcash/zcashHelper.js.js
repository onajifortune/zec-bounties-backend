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
      chain: true,
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
async function getLatestZcashParamsForClient() {
  const params = await prisma.zcashParams.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      serverUrl: true,
      chain: true,
      accountName: true,
      ownerId: true,
    },
  });

  if (!params) return null;

  params.dataDir = path.join(
    process.cwd(),
    "wallets",
    params.ownerId,
    params.accountName,
    params.chain,
  );

  return params; // { serverUrl, chain, accountName, ownerId, dataDir }
}

/**
 * Fetch the default Zcash wallet params for a given user.
 * Falls back to the most recently created params if no default is set.
 * Returns null if the user has no params at all.
 *
 * @param {string} ownerId
 * @returns {Promise<{ serverUrl: string, chain: string, accountName: string, dataDir: string, isDefault: boolean } | null>}
 */
async function getDefaultZcashParams(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");

  let params = await prisma.zcashParams.findFirst({
    where: { ownerId, isDefault: true },
    select: {
      serverUrl: true,
      chain: true,
      accountName: true,
      isDefault: true,
      isTeam: true,
      teamId: true,
    },
  });

  if (!params) {
    params = await prisma.zcashParams.findFirst({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      select: {
        serverUrl: true,
        chain: true,
        accountName: true,
        isDefault: true,
        isTeam: true,
        teamId: true,
      },
    });
  }

  if (!params) return null;

  params.dataDir =
    params.isTeam && params.teamId
      ? path.join(
          process.cwd(),
          "wallets",
          `team:${params.teamId}`,
          params.accountName,
          params.chain,
        )
      : path.join(
          process.cwd(),
          "wallets",
          ownerId,
          params.accountName,
          params.chain,
        );

  return params;
}

module.exports = {
  getLatestZcashParams,
  getLatestZcashParamsForClient,
  getDefaultZcashParams,
};
