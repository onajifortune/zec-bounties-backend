const express = require("express");
const { PrismaClient } = require("@prisma/client");
const router = express.Router();
const { authenticate, isAdmin } = require("../middleware/auth");
const { delCache } = require("../utils/cache");
const prisma = new PrismaClient();

// Helper function to generate completedAt filter based on timeRange
function getCompletedAtFilter(timeRange) {
  if (!timeRange || timeRange === "all") {
    return {};
  }
  const now = new Date();
  let fromDate;
  if (timeRange === "30d") {
    fromDate = new Date(now.setDate(now.getDate() - 30));
  } else if (timeRange === "90d") {
    fromDate = new Date(now.setDate(now.getDate() - 90));
  } else {
    return {};
  }
  return {
    completedAt: {
      gte: fromDate,
      not: null,
    },
  };
}

function getChainFilter(chain) {
  if (chain === "TEST") return { chain: "TEST" };
  if (chain === "ALL") return {};
  return { chain: "MAIN" };
}

router.get("/top-contributors", async (req, res) => {
  try {
    const showAll = req.query.all === "true";
    const timeRange = req.query.timeRange || "all";
    const completedAtFilter = getCompletedAtFilter(timeRange);
    const chainFilter = getChainFilter(req.query.chain);

    // submitted = how many times a user submitted work, grouped by submitter,
    // scoped to chain via the related bounty. NOT time-filtered — lifetime count,
    // same semantics as before. NOT deduped per bounty — each submission event counts.
    const submissionGroups = await prisma.workSubmission.groupBy({
      by: ["submittedBy"],
      _count: { _all: true },
      where: {
        bounty: { ...chainFilter },
      },
    });
    const submittedMap = new Map(
      submissionGroups.map((g) => [g.submittedBy, g._count._all]),
    );

    const buildUserEntry = (user) => {
      const hasUA = !!user.UA_address;
      const hasZ = !!user.z_address;
      let addressType = "None";
      if (hasUA && hasZ) addressType = "UA + z";
      else if (hasUA) addressType = "UA only";
      else if (hasZ) addressType = "Sapling";

      const userBadges = Array.isArray(user.badges) ? [...user.badges] : [];
      if (user.role === "ADMIN") {
        if (!userBadges.includes("dao-member")) userBadges.push("dao-member");
        if (!userBadges.includes("admin")) userBadges.push("admin");
      }

      return {
        id: user.id,
        name: user.name || "Unknown",
        avatar: user.avatar || null,
        addressType,
        badges: userBadges,
        completed: 0,
        submitted: submittedMap.get(user.id) || 0,
        totalEarned: 0,
      };
    };

    if (showAll) {
      const allUsers = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          avatar: true,
          UA_address: true,
          z_address: true,
          role: true,
          badges: true,
        },
      });

      const userMap = new Map();
      allUsers.forEach((u) => userMap.set(u.id, buildUserEntry(u)));

      const userBounties = await prisma.bounty.findMany({
        where: { assignee: { not: null }, ...chainFilter },
        select: {
          assignee: true,
          status: true,
          bountyAmount: true,
          completedAt: true,
        },
      });

      userBounties.forEach((bounty) => {
        const stats = userMap.get(bounty.assignee);
        if (!stats) return;

        const isCompleted = bounty.status === "DONE" && bounty.completedAt;
        if (!isCompleted) return;
        if (
          completedAtFilter.completedAt &&
          new Date(bounty.completedAt) < completedAtFilter.completedAt.gte
        ) {
          return;
        }

        stats.completed += 1;
        stats.totalEarned += bounty.bountyAmount || 0;
      });

      const sorted = Array.from(userMap.values()).sort(
        (a, b) => b.completed - a.completed,
      );
      return res.json(sorted);
    }

    // ==================== NORMAL TOP CONTRIBUTORS (Top 25) ====================
    const bounties = await prisma.bounty.findMany({
      where: { assignee: { not: null }, ...chainFilter },
      select: {
        assignee: true,
        status: true,
        bountyAmount: true,
        completedAt: true,
        assigneeUser: {
          select: {
            id: true,
            name: true,
            avatar: true,
            UA_address: true,
            z_address: true,
            role: true,
            badges: true,
          },
        },
      },
    });

    const userStats = new Map();

    bounties.forEach((bounty) => {
      if (!bounty.assigneeUser) return;
      const userId = bounty.assigneeUser.id;

      if (!userStats.has(userId)) {
        userStats.set(userId, buildUserEntry(bounty.assigneeUser));
      }

      const stats = userStats.get(userId);
      const isCompleted = bounty.status === "DONE" && bounty.completedAt;
      if (!isCompleted) return;
      if (
        completedAtFilter.completedAt &&
        new Date(bounty.completedAt) < completedAtFilter.completedAt.gte
      ) {
        return;
      }

      stats.completed += 1;
      stats.totalEarned += bounty.bountyAmount || 0;
    });

    // Users who submitted work but were never the final `assignee` on a bounty
    // (e.g. lost the slot in a multi-assignee bounty) would otherwise be
    // invisible here despite having a real submitted count.
    const missingSubmitterIds = [...submittedMap.keys()].filter(
      (id) => !userStats.has(id),
    );
    if (missingSubmitterIds.length > 0) {
      const missingUsers = await prisma.user.findMany({
        where: { id: { in: missingSubmitterIds } },
        select: {
          id: true,
          name: true,
          avatar: true,
          UA_address: true,
          z_address: true,
          role: true,
          badges: true,
        },
      });
      missingUsers.forEach((u) => userStats.set(u.id, buildUserEntry(u)));
    }

    const sorted = Array.from(userStats.values())
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 25);

    res.json(sorted);
  } catch (error) {
    console.error("Error in /top-contributors:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// GET /api/kpis/contributors-over-time
router.get("/contributors-over-time", async (req, res) => {
  try {
    const chainFilter = getChainFilter(req.query.chain);

    const completedBounties = await prisma.bounty.findMany({
      where: {
        status: "DONE",
        ...chainFilter,
        completedAt: { not: null },
      },
      select: {
        completedAt: true,
        assignee: true,
      },
      orderBy: {
        completedAt: "asc",
      },
    });

    const monthlyData = new Map();
    completedBounties.forEach((bounty) => {
      if (!bounty.completedAt) return;
      const date = new Date(bounty.completedAt);
      const monthKey = date.toISOString().slice(0, 7);
      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, new Set());
      }
      monthlyData.get(monthKey).add(bounty.assignee);
    });

    const result = [];
    let cumulative = new Set();
    const sortedMonths = Array.from(monthlyData.keys()).sort();

    sortedMonths.forEach((month) => {
      const contributorsThisMonth = monthlyData.get(month);
      contributorsThisMonth.forEach((id) => cumulative.add(id));
      result.push({
        month,
        cumulativeContributors: cumulative.size,
      });
    });

    res.json(result);
  } catch (error) {
    console.error("Error in /contributors-over-time:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// GET /api/kpis/average-earnings-over-time
router.get("/average-earnings-over-time", async (req, res) => {
  try {
    const timeRange = req.query.timeRange || "all";
    const completedAtFilter = getCompletedAtFilter(timeRange);
    const chainFilter = getChainFilter(req.query.chain);

    const completedBounties = await prisma.bounty.findMany({
      where: {
        status: "DONE",
        ...chainFilter,
        completedAt: { not: null },
        ...completedAtFilter,
      },
      select: {
        completedAt: true,
        bountyAmount: true,
        assignee: true,
      },
      orderBy: {
        completedAt: "asc",
      },
    });

    if (completedBounties.length === 0) {
      return res.json([]);
    }

    const monthlyData = new Map();

    completedBounties.forEach((bounty) => {
      if (!bounty.completedAt) return;
      const date = new Date(bounty.completedAt);
      const monthKey = date.toISOString().slice(0, 7);

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, {
          totalPaid: 0,
          earners: new Set(),
          earningsList: [],
        });
      }

      const monthStats = monthlyData.get(monthKey);
      monthStats.totalPaid += bounty.bountyAmount || 0;
      monthStats.earners.add(bounty.assignee);
      monthStats.earningsList.push(bounty.bountyAmount || 0);
    });

    const result = [];

    for (const [month, stats] of monthlyData.entries()) {
      const uniqueEarners = stats.earners.size;
      const average = uniqueEarners > 0 ? stats.totalPaid / uniqueEarners : 0;

      const sorted = stats.earningsList.sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];

      result.push({
        month,
        average: parseFloat(average.toFixed(4)),
        median: parseFloat(median.toFixed(4)),
        totalPaid: parseFloat(stats.totalPaid.toFixed(4)),
        uniqueEarners,
      });
    }

    result.sort((a, b) => a.month.localeCompare(b.month));
    res.json(result);
  } catch (error) {
    console.error("Error in /average-earnings-over-time:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// PATCH /api/kpis/users/:id/badges
router.patch("/users/:id/badges", authenticate, isAdmin, async (req, res) => {
  try {
    const { badges } = req.body;
    if (!Array.isArray(badges)) {
      return res.status(400).json({ error: "badges must be an array" });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { badges },
      select: { id: true, name: true, badges: true },
    });

    await delCache("users:all");
    res.json(updated);
  } catch (error) {
    console.error("Failed to update badges:", error);
    res.status(500).json({ error: "Failed to update badges" });
  }
});

// GET /api/kpis/bounty-types-over-time
// Left as dateCreated — this tracks when bounty *categories* were created/opened,
// not completion, so it's intentionally unaffected by this change.
router.get("/bounty-types-over-time", async (req, res) => {
  try {
    const chainFilter = getChainFilter(req.query.chain);

    const bounties = await prisma.bounty.findMany({
      where: {
        category: { isNot: null },
        ...chainFilter,
      },
      select: {
        dateCreated: true,
        category: {
          select: { name: true },
        },
      },
      orderBy: {
        dateCreated: "asc",
      },
    });

    const monthlyData = new Map();

    bounties.forEach((bounty) => {
      if (!bounty.dateCreated || !bounty.category) return;
      const date = new Date(bounty.dateCreated);
      const monthKey = date.toISOString().slice(0, 7);
      const categoryName = bounty.category.name;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, new Map());
      }
      const categoryMap = monthlyData.get(monthKey);
      categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + 1);
    });

    const result = Array.from(monthlyData.entries()).map(
      ([month, categoryMap]) => {
        const entry = { month };
        categoryMap.forEach((count, category) => {
          entry[category] = count;
        });
        return entry;
      },
    );

    res.json(result);
  } catch (error) {
    console.error("Error in /bounty-types-over-time:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

module.exports = router;
