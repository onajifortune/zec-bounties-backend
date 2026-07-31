const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const prisma = require("../prisma/client");
const { authenticate } = require("../middleware/auth");

const SECRET = process.env.JWT_SECRET;

// ─── Has this user already chosen Hunter or Teams? ────────────────────────────
// Frontend calls this right after login to decide whether to show the gate.
router.get("/status", authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, roleSelectedAt: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      needsOnboarding: user.roleSelectedAt === null,
      role: user.role,
    });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    res.status(500).json({ error: "Failed to check onboarding status" });
  }
});

// ─── Select Hunter or Teams (one-time — locked by roleSelectedAt) ─────────────
router.post("/select-role", authenticate, async (req, res) => {
  try {
    const { role, teamName } = req.body;
    const userId = req.user.id;

    if (!["HUNTER", "TEAM"].includes(role)) {
      return res.status(400).json({ error: "role must be HUNTER or TEAM" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, roleSelectedAt: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.roleSelectedAt !== null) {
      return res.status(403).json({
        error:
          "You've already selected Hunter or Teams. Contact an admin to change it.",
      });
    }

    // ── HUNTER: simple role flip, no team involved ──────────────────────────
    if (role === "HUNTER") {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { role: "HUNTER", roleSelectedAt: new Date() },
        select: { id: true, name: true, role: true, roleSelectedAt: true },
      });
      const token = jwt.sign({ id: updated.id, role: updated.role }, SECRET, {
        expiresIn: "7d",
      });
      return res.json({ user: updated, token });
    }

    // ── TEAM: create the Team + TeamMember(OWNER) in one transaction ────────
    const resolvedTeamName = teamName?.trim() || `${user.name}'s Team`;

    const existingTeam = await prisma.team.findUnique({
      where: { name: resolvedTeamName },
      select: { id: true },
    });
    if (existingTeam) {
      return res.status(400).json({
        error: `Team name "${resolvedTeamName}" is already taken — please choose another`,
        code: "TEAM_NAME_TAKEN",
      });
    }

    const [updatedUser, team] = await prisma.$transaction(async (tx) => {
      const newTeam = await tx.team.create({
        data: { name: resolvedTeamName },
      });

      await tx.teamMember.create({
        data: { teamId: newTeam.id, userId, role: "OWNER" },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { role: "TEAM", roleSelectedAt: new Date() },
        select: { id: true, name: true, role: true, roleSelectedAt: true },
      });

      return [updated, newTeam];
    });

    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role },
      SECRET,
      {
        expiresIn: "7d",
      },
    );

    res.json({ user: updatedUser, team, token });
  } catch (error) {
    console.error("Error selecting role:", error);
    res.status(500).json({ error: "Failed to select role" });
  }
});

module.exports = router;
