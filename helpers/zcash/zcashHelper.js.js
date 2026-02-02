const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/**
 * Fetch latest Zcash params for a given user
 * @param {string} ownerId - The current user's ID
 * @returns {Promise<{ serverUrl: string, chain: string } | null>}
 */
async function getLatestZcashParams(ownerId) {
  if (!ownerId) throw new Error("ownerId is required");

  const params = await prisma.zcashParams.findFirst({
    where: { ownerId },
    orderBy: { createdAt: "desc" }, // latest one first
    select: { serverUrl: true, chain: true }, // only what we need
  });

  if (!params) return null; // user has no Zcash params yet
  params.dataDir = `~/Desktop/Projects/data-zingolib/.cache/zingolibData/recover/${params.chain}`;

  return params; // { serverUrl, chain }
}

module.exports = { getLatestZcashParams };
