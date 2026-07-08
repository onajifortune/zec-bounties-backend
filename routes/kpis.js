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

module.exports = router;
