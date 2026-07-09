const express = require("express");
const { PrismaClient } = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

router.get("/top-contributors", async (req, res) => {
  try {
    const showAll = req.query.all === "true";

    if (showAll) {
      // ==================== SHOW ALL USERS ====================
      const allUsers = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          avatar: true,
          UA_address: true,
          z_address: true,
        },
      });

      const userMap = new Map();

      allUsers.forEach((u) => {
        const hasUA = !!u.UA_address;
        const hasZ = !!u.z_address;

        let addressType = "None";
        if (hasUA && hasZ) addressType = "UA + z";
        else if (hasUA) addressType = "UA only";
        else if (hasZ) addressType = "Sapling";

        userMap.set(u.id, {
          id: u.id,
          name: u.name || "Unknown",
          avatar: u.avatar || null,
          addressType,
          completed: 0,
          submitted: 0,
          totalEarned: 0,
        });
      });

      const userBounties = await prisma.bounty.findMany({
        where: { assignee: { not: null } },
        select: {
          assignee: true,
          status: true,
          bountyAmount: true,
          dateCreated: true,
          paidAt: true,
        },
      });

      userBounties.forEach((bounty) => {
        const stats = userMap.get(bounty.assignee);
        if (!stats) return;

        stats.submitted += 1;
        if (bounty.status === "DONE") {
          stats.completed += 1;
          stats.totalEarned += bounty.bountyAmount || 0;
        }
      });

      const sorted = Array.from(userMap.values()).sort(
        (a, b) => b.completed - a.completed,
      );

      return res.json(sorted);
    }

    // ==================== NORMAL TOP CONTRIBUTORS ====================
    const bounties = await prisma.bounty.findMany({
      where: { assignee: { not: null } },
      select: {
        assignee: true,
        status: true,
        bountyAmount: true,
        dateCreated: true,
        paidAt: true,
        assigneeUser: {
          select: {
            id: true,
            name: true,
            avatar: true,
            UA_address: true,
            z_address: true,
          },
        },
      },
    });

    const userStats = new Map();

    bounties.forEach((bounty) => {
      if (!bounty.assigneeUser) return;

      const userId = bounty.assigneeUser.id;

      if (!userStats.has(userId)) {
        const hasUA = !!bounty.assigneeUser.UA_address;
        const hasZ = !!bounty.assigneeUser.z_address;

        let addressType = "None";
        if (hasUA && hasZ) addressType = "UA + z";
        else if (hasUA) addressType = "UA only";
        else if (hasZ) addressType = "Sapling";

        userStats.set(userId, {
          id: userId,
          name: bounty.assigneeUser.name || "Unknown",
          avatar: bounty.assigneeUser.avatar || null,
          addressType,
          completed: 0,
          submitted: 0,
          totalEarned: 0,
        });
      }

      const stats = userStats.get(userId);
      stats.submitted += 1;

      if (bounty.status === "DONE") {
        stats.completed += 1;
        stats.totalEarned += bounty.bountyAmount || 0;
      }
    });

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
    const paidBounties = await prisma.bounty.findMany({
      where: {
        status: "DONE",
        paidAt: { not: null },
      },
      select: {
        paidAt: true,
        assignee: true,
      },
      orderBy: {
        paidAt: "asc",
      },
    });

    // Group by month and calculate cumulative unique contributors
    const monthlyData = new Map();

    paidBounties.forEach((bounty) => {
      if (!bounty.paidAt) return;

      const date = new Date(bounty.paidAt);
      const monthKey = date.toISOString().slice(0, 7); // YYYY-MM

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, new Set());
      }

      monthlyData.get(monthKey).add(bounty.assignee);
    });

    // Convert to array with cumulative count
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

// GET /api/kpis/bounty-types-over-time
router.get("/bounty-types-over-time", async (req, res) => {
  try {
    const bounties = await prisma.bounty.findMany({
      where: {
        category: { isNot: null },
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

    // Group by month + category
    const monthlyData = new Map();

    bounties.forEach((bounty) => {
      if (!bounty.dateCreated || !bounty.category) return;

      const date = new Date(bounty.dateCreated);
      const monthKey = date.toISOString().slice(0, 7); // YYYY-MM
      const categoryName = bounty.category.name;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, new Map());
      }

      const categoryMap = monthlyData.get(monthKey);
      categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + 1);
    });

    // Convert to array format for frontend
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
