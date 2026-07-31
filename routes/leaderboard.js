const express = require("express");
const prisma = require("../prisma/client");
const router = express.Router();
const {
  getCache,
  setCache,
  deleteCacheByPattern,
  TTL,
} = require("../utils/cache");

// ─── Select shape ──────────────────────────────────────────────────────────
const USER_SELECT = { id: true, name: true, nickname: true, avatar: true };

// ─── Filter helpers ────────────────────────────────────────────────────────
function getCompletedAtFilter(timeRange) {
  if (!timeRange || timeRange === "all") return null;
  const now = new Date();
  let fromDate;
  if (timeRange === "30d") fromDate = new Date(now.setDate(now.getDate() - 30));
  else if (timeRange === "90d")
    fromDate = new Date(now.setDate(now.getDate() - 90));
  else return null;
  return fromDate;
}

function getChainFilter(chain) {
  if (chain === "TEST") return { chain: "TEST" };
  if (chain === "ALL") return {};
  return { chain: "MAIN" }; // default
}

// ─── GET /leaderboard ──────────────────────────────────────────────────────
// Ranks users by completed bounties + total earnings.
// Query params:
//   timeRange = "all" | "30d" | "90d"  (default "all")
//   chain     = "MAIN" | "TEST" | "ALL" (default "MAIN")
//   limit     = number, capped at 100    (default 25)
router.get("/", async (req, res) => {
  try {
    const timeRange = req.query.timeRange || "all";
    const chain = req.query.chain || "MAIN";
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);

    const fromDate = getCompletedAtFilter(timeRange);
    const chainFilter = getChainFilter(chain);

    const cacheKey = `leaderboard:${JSON.stringify({ timeRange, chain, limit })}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const bounties = await prisma.bounty.findMany({
      where: {
        status: "DONE",
        assignee: { not: null },
        completedAt: { not: null },
        ...chainFilter,
        ...(fromDate && { completedAt: { gte: fromDate, not: null } }),
      },
      select: {
        assignee: true,
        bountyAmount: true,
        completedAt: true,
        assigneeUser: {
          select: USER_SELECT,
        },
      },
    });

    const statsByUser = new Map();

    for (const bounty of bounties) {
      if (!bounty.assigneeUser) continue; // orphaned assignee id — skip safely

      const userId = bounty.assigneeUser.id;
      const existing = statsByUser.get(userId) ?? {
        id: userId,
        name: bounty.assigneeUser.name,
        nickname: bounty.assigneeUser.nickname,
        avatar: bounty.assigneeUser.avatar,
        earned: 0,
        completed: 0,
      };

      existing.earned += bounty.bountyAmount || 0;
      existing.completed += 1;
      statsByUser.set(userId, existing);
    }

    const ranked = Array.from(statsByUser.values())
      .map((s) => ({
        ...s,
        points: Math.round(s.earned * 10 + s.completed * 100),
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, limit)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    // Short TTL — leaderboard should feel fresh but doesn't need to be real-time
    await setCache(cacheKey, ranked, TTL.BOUNTY_LIST);

    res.json(ranked);
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// ─── Cache busting helper ──────────────────────────────────────────────────
// Call this from bounties.js's invalidateBounty (and anywhere nicknames
// get updated) so leaderboard results don't go stale after a bounty
// completes or a user renames themselves.
const invalidateLeaderboard = async () => {
  await deleteCacheByPattern("leaderboard:*");
};

module.exports = router;
module.exports.invalidateLeaderboard = invalidateLeaderboard;
