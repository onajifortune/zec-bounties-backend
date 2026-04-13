const express = require("express");
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const { promises: fs } = require("fs");
const { authenticate, isAdmin } = require("../middleware/auth");
const { initZcashOnce } = require("../zcash/init");
const { sendRealtimeUpdate, sendToUser } = require("../middleware/websocket");
const { invalidateZingo } = require("../utils/getZingo");
const executeZingoCliSeed = require("../utils/zingoLibSeed");
const executeZingoCliBalance = require("../utils/zingoLibBalance");
const executeZingoCliAddresses = require("../utils/zingoLibAddresses");
const executeZingoCliSync = require("../utils/zingoLibSync");
const executeZingoQuickSend = require("../utils/zingoLibQuickSend");

const prisma = new PrismaClient();
const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the team wallet's dataDir the same way individual wallets do,
 * but rooted under  wallets/teams/<teamId>/  instead of  wallets/<userId>/
 */
function teamDataDir(teamId, accountName, chain) {
  return path.join(
    process.cwd(),
    "wallets",
    `team:${teamId}`,
    accountName,
    chain,
  );
}

/**
 * Check that the calling user is a member of the team.
 * Returns the TeamMember record or null.
 */
async function getTeamMember(teamId, userId) {
  return prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
}

/**
 * Check that the calling user is a team OWNER or ADMIN, or a global ADMIN.
 */
async function requireTeamAdmin(teamId, req, res) {
  if (req.user.role === "ADMIN") return true; // global admin always passes

  const member = await getTeamMember(teamId, req.user.id);
  if (!member || !["OWNER", "ADMIN"].includes(member.role)) {
    res.status(403).json({ error: "Team admin access required" });
    return false;
  }
  return true;
}

// Helper — gets or creates a synthetic User row for the team
async function getOrCreateTeamUser(teamId) {
  const syntheticEmail = `team+${teamId}@internal.local`;

  const existing = await prisma.user.findUnique({
    where: { email: syntheticEmail },
  });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      id: `team:${teamId}`,
      name: `Team ${teamId}`,
      email: syntheticEmail,
      role: "TEAM",
    },
  });
}

async function syncWalletToMembers(teamId, wallet, userIds) {
  if (!wallet || !userIds.length) return;

  // findFirst instead of findUnique — ownerId_accountName no longer exists
  // as a two-field key after teamId was added to the unique constraint.
  const teamParams = await prisma.zcashParams.findFirst({
    where: { teamId, accountName: wallet.accountName },
  });

  if (!teamParams) return; // wallet not fully initialized yet

  for (const userId of userIds) {
    await prisma.$transaction(
      async (tx) => {
        // Demote any existing default for this user
        await tx.zcashParams.updateMany({
          where: { ownerId: userId, isDefault: true },
          data: { isDefault: false },
        });

        // Upsert a ZcashParams row for this user pointing to the team wallet.
        // SQLite doesn't treat two NULLs as equal in a unique index, but teamId
        // is non-null here so the compound key works fine.
        await tx.zcashParams.upsert({
          where: {
            ownerId_accountName_teamId: {
              ownerId: userId,
              accountName: wallet.accountName,
              teamId,
            },
          },
          update: {
            isDefault: true,
            isTeam: true,
            teamId,
            chain: wallet.chain,
            serverUrl: wallet.serverUrl,
          },
          create: {
            ownerId: userId,
            accountName: wallet.accountName,
            chain: wallet.chain,
            serverUrl: wallet.serverUrl,
            isDefault: true,
            isTeam: true,
            teamId,
          },
        });
      },
      { timeout: 10000 },
    );
  }
}

async function removeWalletFromMembers(teamId, wallet, userIds) {
  if (!wallet || !userIds.length) return;

  for (const userId of userIds) {
    // Delete the team wallet param for this user
    await prisma.zcashParams
      .deleteMany({
        where: { ownerId: userId, accountName: wallet.accountName, teamId },
      })
      .catch(() => {});

    // Promote the most recent remaining param to default if none left default
    const hasDefault = await prisma.zcashParams.findFirst({
      where: { ownerId: userId, isDefault: true },
    });

    if (!hasDefault) {
      const latest = await prisma.zcashParams.findFirst({
        where: { ownerId: userId },
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        await prisma.zcashParams.update({
          where: { id: latest.id },
          data: { isDefault: true },
        });
      }
    }
  }
}

// ─── Team CRUD ───────────────────────────────────────────────────────────────

// Create a team — any authenticated user can create one; they become OWNER
router.post("/", authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Team name is required" });
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        members: {
          create: {
            userId: req.user.id,
            role: "OWNER",
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        wallet: true,
      },
    });

    sendRealtimeUpdate("team_created", team, req.user.id);
    res.status(201).json(team);
  } catch (err) {
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "A team with that name already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create team" });
  }
});

// List all teams (admin) or only teams the user belongs to
router.get("/", authenticate, async (req, res) => {
  try {
    const where =
      req.user.role === "ADMIN"
        ? {}
        : { members: { some: { userId: req.user.id } } };

    const teams = await prisma.team.findMany({
      where,
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        wallet: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(teams);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch teams" });
  }
});

// Get a single team
router.get("/:teamId", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
        wallet: true,
      },
    });

    if (!team) return res.status(404).json({ error: "Team not found" });

    // Non-admins must be a member to view
    if (req.user.role !== "ADMIN") {
      const member = await getTeamMember(teamId, req.user.id);
      if (!member) return res.status(403).json({ error: "Access denied" });
    }

    res.json(team);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch team" });
  }
});

// Update team metadata (team admin / global admin only)
router.patch("/:teamId", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const { name, description } = req.body;
    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined)
      data.description = description?.trim() || null;

    const team = await prisma.team.update({
      where: { id: teamId },
      data,
      include: { members: true, wallet: true },
    });

    sendRealtimeUpdate("team_updated", team, req.user.id);
    res.json(team);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Team name already taken" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update team" });
  }
});

// Delete team (team OWNER or global admin)
router.delete("/:teamId", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    // Only OWNER or global admin may delete
    if (req.user.role !== "ADMIN") {
      const member = await getTeamMember(teamId, req.user.id);
      if (!member || member.role !== "OWNER") {
        return res
          .status(403)
          .json({ error: "Only the team owner can delete a team" });
      }
    }

    // Delete wallet folder from disk if it exists
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { wallet: true },
    });

    if (team?.wallet) {
      const dataDir = teamDataDir(
        teamId,
        team.wallet.accountName,
        team.wallet.chain,
      );
      invalidateZingo({
        chain: team.wallet.chain,
        serverUrl: team.wallet.serverUrl,
        dataDir,
      });
      await fs.rm(dataDir, { recursive: true, force: true });
    }

    await prisma.team.delete({ where: { id: teamId } }); // cascades members + wallet

    await prisma.user.deleteMany({
      where: { email: `team+${teamId}@internal.local` },
    });

    sendRealtimeUpdate("team_deleted", { id: teamId }, req.user.id);
    res.json({ message: "Team deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete team" });
  }
});

// ─── Member Management ────────────────────────────────────────────────────────

// Add member(s) to a team
router.post("/:teamId/members", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const { userIds, role = "MEMBER" } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "userIds array is required" });
    }

    if (!["ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ error: "Role must be ADMIN or MEMBER" });
    }

    const members = await Promise.all(
      userIds.map((userId) =>
        prisma.teamMember.upsert({
          where: { teamId_userId: { teamId, userId } },
          update: { role },
          create: { teamId, userId, role },
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        }),
      ),
    );

    // ── Auto-set team wallet as default for new members ──
    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (wallet) {
      await syncWalletToMembers(teamId, wallet, userIds);
    }

    sendRealtimeUpdate(
      "team_members_updated",
      { teamId, members },
      req.user.id,
    );
    res.status(201).json({ members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add team members" });
  }
});

// Update a member's role
router.patch("/:teamId/members/:userId", authenticate, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const { role } = req.body;
    if (!["OWNER", "ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const member = await prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { role },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    sendRealtimeUpdate(
      "team_member_role_updated",
      { teamId, member },
      req.user.id,
    );
    res.json(member);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update member role" });
  }
});

// Remove a member
router.delete("/:teamId/members/:userId", authenticate, async (req, res) => {
  try {
    const { teamId, userId } = req.params;

    if (userId !== req.user.id) {
      if (!(await requireTeamAdmin(teamId, req, res))) return;
    }

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });

    // ── Remove team wallet from this member's params ──
    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (wallet) {
      await removeWalletFromMembers(teamId, wallet, [userId]);
    }

    sendRealtimeUpdate("team_member_removed", { teamId, userId }, req.user.id);
    res.json({ message: "Member removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ─── Team Wallet ─────────────────────────────────────────────────────────────

// Create / initialise the shared team wallet
router.post("/:teamId/wallet", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const {
      accountName,
      chain = "mainnet",
      serverUrl = "https://zec.rocks:443",
    } = req.body;

    if (!accountName?.trim()) {
      return res.status(400).json({ error: "accountName is required" });
    }

    const existing = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (existing) {
      return res.status(409).json({
        error: "Team already has a wallet. Delete it first to replace.",
      });
    }

    let wallet = null;
    let teamUser = null;

    try {
      wallet = await prisma.teamWallet.create({
        data: { teamId, accountName: accountName.trim(), chain, serverUrl },
      });

      await initZcashOnce(req.user.id, wallet.accountName, wallet.chain);
    } catch (err) {
      // Roll back DB records
      if (wallet) {
        await prisma.teamWallet
          .delete({ where: { id: wallet.id } })
          .catch(() => {});
      }
      if (teamUser) {
        await prisma.zcashParams
          .deleteMany({
            where: { ownerId: teamUser.id, accountName: wallet?.accountName },
          })
          .catch(() => {});
        // Only delete the synthetic user if they have no other params left
        const remaining = await prisma.zcashParams.count({
          where: { ownerId: teamUser.id },
        });
        if (remaining === 0) {
          await prisma.user
            .delete({ where: { id: teamUser.id } })
            .catch(() => {});
        }
      }
      // Roll back the wallet directory if it was created
      const walletDir = path.join(
        process.cwd(),
        "wallets",
        `team:${teamId}`,
        accountName.trim(),
        chain,
      );
      await fs.rm(walletDir, { recursive: true, force: true }).catch(() => {});

      throw err; // re-throw to outer catch
    }

    const allMembers = await prisma.teamMember.findMany({ where: { teamId } });
    const memberUserIds = allMembers.map((m) => m.userId);
    await syncWalletToMembers(teamId, wallet, memberUserIds);

    sendRealtimeUpdate("team_wallet_created", { teamId, wallet }, req.user.id);
    res.status(201).json({ success: true, wallet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create team wallet" });
  }
});

router.post("/:teamId/wallet/import", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const {
      accountName,
      seedPhrase,
      chain = "mainnet",
      serverUrl = "https://zec.rocks:443",
      birthdayHeight,
    } = req.body;

    if (!accountName?.trim() || !seedPhrase) {
      return res
        .status(400)
        .json({ error: "accountName and seedPhrase are required" });
    }

    const words = seedPhrase.trim().split(/\s+/);
    if (words.length !== 24) {
      return res.status(400).json({ error: "Seed phrase must be 24 words" });
    }

    const existing = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (existing) {
      return res.status(409).json({ error: "Team already has a wallet" });
    }

    let wallet = null;
    let teamUser = null;

    try {
      wallet = await prisma.teamWallet.create({
        data: { teamId, accountName: accountName.trim(), chain, serverUrl },
      });

      await initZcashOnce(
        req.user.id,
        wallet.accountName,
        wallet.chain,
        teamId,
      );

      const params = buildTeamParams(teamId, wallet);
      await executeZingoCliSeed(params, seedPhrase, birthdayHeight);
    } catch (err) {
      // Roll back DB records
      if (wallet) {
        await prisma.teamWallet
          .delete({ where: { id: wallet.id } })
          .catch(() => {});
      }
      if (teamUser) {
        await prisma.zcashParams
          .deleteMany({
            where: { ownerId: teamUser.id, accountName: wallet?.accountName },
          })
          .catch(() => {});
        const remaining = await prisma.zcashParams.count({
          where: { ownerId: teamUser.id },
        });
        if (remaining === 0) {
          await prisma.user
            .delete({ where: { id: teamUser.id } })
            .catch(() => {});
        }
      }
      // Roll back the wallet directory
      const walletDir = path.join(
        process.cwd(),
        "wallets",
        `team:${teamId}`,
        accountName.trim(),
        chain,
      );
      await fs.rm(walletDir, { recursive: true, force: true }).catch(() => {});

      throw err;
    }

    const allMembers = await prisma.teamMember.findMany({ where: { teamId } });
    const memberUserIds = allMembers.map((m) => m.userId);
    await syncWalletToMembers(teamId, wallet, memberUserIds);

    sendRealtimeUpdate("team_wallet_imported", { teamId, wallet }, req.user.id);
    res.status(201).json({ success: true, wallet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to import team wallet" });
  }
});

// Get team wallet info (any team member)
router.get("/:teamId/wallet", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    const member =
      req.user.role === "ADMIN"
        ? true
        : await getTeamMember(teamId, req.user.id);
    if (!member) return res.status(403).json({ error: "Access denied" });

    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for this team" });

    res.json({ success: true, wallet });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch team wallet" });
  }
});

// Get team wallet balance (any team member)
router.get("/:teamId/wallet/balance", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    const member =
      req.user.role === "ADMIN"
        ? true
        : await getTeamMember(teamId, req.user.id);
    if (!member) return res.status(403).json({ error: "Access denied" });

    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for this team" });

    const params = buildTeamParams(teamId, wallet);
    const data = await executeZingoCliBalance("balance", params);

    const balance =
      wallet.chain === "testnet"
        ? data.confirmed_orchard_balance
        : data.confirmed_sapling_balance;

    sendToUser(req.user.id, "team_balance_fetched", { teamId, balance });
    res.json({ success: true, balance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch team wallet balance" });
  }
});

// Get team wallet addresses (any team member)
router.get("/:teamId/wallet/addresses", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    const member =
      req.user.role === "ADMIN"
        ? true
        : await getTeamMember(teamId, req.user.id);
    if (!member) return res.status(403).json({ error: "Access denied" });

    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for this team" });

    const params = buildTeamParams(teamId, wallet);
    const addresses = await executeZingoCliAddresses("addresses", params);

    sendToUser(req.user.id, "team_addresses_fetched", { teamId, addresses });
    res.json({ success: true, addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch team wallet addresses" });
  }
});

// Send payment from team wallet (team admin or global admin)
router.post("/:teamId/wallet/pay", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;
    if (!(await requireTeamAdmin(teamId, req, res))) return;

    const { payments } = req.body; // [{ address, amount (ZEC), memo }]

    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: "payments array is required" });
    }

    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for this team" });

    const params = buildTeamParams(teamId, wallet);

    // Convert to zatoshis, same as authorize-payment route
    const paymentList = payments.map((p) => ({
      address: p.address,
      amount: Math.round(p.amount * 1e8),
      memo: p.memo || "",
    }));

    const sendResult = await executeZingoQuickSend(paymentList, params);

    if (sendResult.error) {
      return res.status(422).json({
        success: false,
        error: "Payment failed",
        details: sendResult.error,
      });
    }

    sendRealtimeUpdate(
      "team_payment_sent",
      { teamId, result: sendResult[1] },
      req.user.id,
    );
    res.json({ success: true, result: sendResult[1] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send team payment" });
  }
});

// Delete team wallet (team OWNER or global admin)
router.delete("/:teamId/wallet", authenticate, async (req, res) => {
  try {
    const { teamId } = req.params;

    if (req.user.role !== "ADMIN") {
      const member = await getTeamMember(teamId, req.user.id);
      if (!member || member.role !== "OWNER") {
        return res
          .status(403)
          .json({ error: "Only the team owner can delete the wallet" });
      }
    }

    const wallet = await prisma.teamWallet.findUnique({ where: { teamId } });
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });

    // ── Remove wallet params from all members before deleting ──
    const allMembers = await prisma.teamMember.findMany({ where: { teamId } });
    await removeWalletFromMembers(
      teamId,
      wallet,
      allMembers.map((m) => m.userId),
    );

    const dataDir = teamDataDir(teamId, wallet.accountName, wallet.chain);
    invalidateZingo({
      chain: wallet.chain,
      serverUrl: wallet.serverUrl,
      dataDir,
    });
    await fs.rm(dataDir, { recursive: true, force: true });

    await prisma.teamWallet.delete({ where: { teamId } });

    sendRealtimeUpdate("team_wallet_deleted", { teamId }, req.user.id);
    res.json({ message: "Team wallet deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete team wallet" });
  }
});

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Build the minimal params object that all executeZingo* utilities expect,
 * using the team's folder convention.
 */
function buildTeamParams(teamId, wallet) {
  return {
    chain: wallet.chain,
    serverUrl: wallet.serverUrl,
    accountName: wallet.accountName,
    // Must match the path initZcashOnce builds: wallets/<ownerId>/<accountName>/<chain>
    dataDir: path.join(
      process.cwd(),
      "wallets",
      `team:${teamId}`,
      wallet.accountName,
      wallet.chain,
    ),
  };
}

module.exports = router;
