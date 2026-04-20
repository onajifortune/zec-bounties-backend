const express = require("express");
const prisma = require("../prisma/client");

const router = express.Router();
const { authenticate, isAdmin } = require("../middleware/auth");
const { sendRealtimeUpdate } = require("../middleware/websocket");
const {
  getCache,
  setCache,
  delCache,
  deleteCacheByPattern,
  TTL,
} = require("../utils/cache");

// ─── Reusable select shapes (avoids re-typing & keeps payloads small) ─────────
const USER_SELECT = { id: true, name: true, avatar: true };
const USER_SELECT_FULL = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  z_address: true,
};
// Consistent shape for createdByUser across all routes
const CREATED_BY_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
};
const ASSIGNEE_INCLUDE = {
  assignees: {
    include: { user: { select: USER_SELECT } },
  },
};

// ─── Reusable include block used on most bounty reads ─────────────────────────
const BOUNTY_INCLUDE = {
  createdByUser: { select: CREATED_BY_SELECT },
  assigneeUser: { select: USER_SELECT_FULL },
  ...ASSIGNEE_INCLUDE,
};

// helper — call after any write that touches a specific bounty
const invalidateBounty = async (bountyId) => {
  await Promise.all([
    delCache(`bounty:${bountyId}`),
    delCache(`assignees:${bountyId}`),
    deleteCacheByPattern("bounties:*"),
  ]);
};

const invalidateApplications = async (applicantId) => {
  await Promise.all([
    delCache(`applications:user:${applicantId}`),
    delCache("applications:all"),
  ]);
};

// ─── Create bounty ────────────────────────────────────────────────────────────
router.post("/", authenticate, async (req, res) => {
  try {
    const {
      title,
      description,
      bountyAmount,
      timeToComplete,
      assignee,
      isApproved,
      categoryId,
    } = req.body;

    const bounty = await prisma.bounty.create({
      data: {
        title,
        description,
        bountyAmount: parseFloat(bountyAmount),
        timeToComplete: new Date(timeToComplete),
        createdBy: req.user.id,
        assignee: assignee === "none" ? null : assignee,
        isApproved,
        categoryId,
      },
      include: BOUNTY_INCLUDE, // return full shape so frontend gets createdByUser immediately
    });

    sendRealtimeUpdate("new_bounty", bounty, req.user.id);
    await deleteCacheByPattern("bounties:*");
    res.status(201).json(bounty);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create bounty" });
  }
});

// ─── List bounties (paginated, lean payload) ──────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const cacheKey = `bounties:${JSON.stringify({ page, limit })}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      console.log("Cache Hit");
      return res.json(cached);
    }
    console.log("Cache Miss");

    const [bounties, total] = await Promise.all([
      prisma.bounty.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { dateCreated: "desc" },
        include: BOUNTY_INCLUDE, // consistent, controlled shape
      }),
      prisma.bounty.count(),
    ]);

    const result = { data: bounties, total, page, limit };

    await setCache(cacheKey, result, TTL.BOUNTY_LIST);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch bounties" });
  }
});

// ─── Add / replace assignees (Admin only) ─────────────────────────────────────
router.post("/:id/assignees", authenticate, isAdmin, async (req, res) => {
  try {
    const { id: bountyId } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: "userIds must be an array" });
    }

    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: { id: true, status: true },
    });
    if (!bounty) return res.status(404).json({ error: "Bounty not found" });

    const [, assignees] = await prisma.$transaction(async (tx) => {
      await tx.bountyAssignee.deleteMany({ where: { bountyId } });

      if (userIds.length === 0) {
        await tx.bounty.update({
          where: { id: bountyId },
          data: { status: "CANCELLED", assignee: null },
        });
        return [null, []];
      }

      await tx.bountyAssignee.createMany({
        data: userIds.map((userId) => ({ bountyId, userId })),
      });

      if (["TO_DO", "CANCELLED"].includes(bounty.status)) {
        await tx.bounty.update({
          where: { id: bountyId },
          data: { status: "IN_PROGRESS" },
        });
      }

      const created = await tx.bountyAssignee.findMany({
        where: { bountyId },
        include: { user: { select: USER_SELECT_FULL } },
      });
      return [null, created];
    });

    sendRealtimeUpdate(
      "bounty_assignees_updated",
      { bountyId, assignees },
      req.user.id,
    );
    await invalidateBounty(bountyId);
    res.status(200).json({ assignees });
  } catch (error) {
    console.error("Error updating assignees:", error);
    res.status(500).json({ error: "Failed to update assignees" });
  }
});

// ─── Remove one assignee (Admin only) ────────────────────────────────────────
router.delete(
  "/:id/assignees/:userId",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { id: bountyId, userId } = req.params;

      await prisma.bountyAssignee.delete({
        where: { bountyId_userId: { bountyId, userId } },
      });

      sendRealtimeUpdate(
        "bounty_assignees_updated",
        { bountyId, removedUserId: userId },
        req.user.id,
      );
      await invalidateBounty(bountyId);
      res.json({ message: "Assignee removed successfully" });
    } catch (error) {
      console.error("Error removing assignee:", error);
      res.status(500).json({ error: "Failed to remove assignee" });
    }
  },
);

// ─── Get assignees for a bounty ───────────────────────────────────────────────
router.get("/:id/assignees", authenticate, async (req, res) => {
  try {
    const cacheKey = `assignees:${req.params.id}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);
    const assignees = await prisma.bountyAssignee.findMany({
      where: { bountyId: req.params.id },
      include: { user: { select: USER_SELECT_FULL } },
      orderBy: { assignedAt: "asc" },
    });
    await setCache(cacheKey, assignees, TTL.ASSIGNEES);
    res.json(assignees);
  } catch (error) {
    console.error("Error fetching assignees:", error);
    res.status(500).json({ error: "Failed to fetch assignees" });
  }
});

// ─── Authorize payment (Admin only) ──────────────────────────────────────────
router.put(
  "/:id/authorize-payment",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { paymentAuthorized } = req.body;

      const updated = await prisma.bounty.update({
        where: { id: req.params.id },
        data: {
          ...(paymentAuthorized !== undefined && {
            paymentAuthorized,
            paymentAuthorizedAt: paymentAuthorized ? new Date() : null,
          }),
        },
        include: BOUNTY_INCLUDE,
      });

      sendRealtimeUpdate("payment_authorized", updated, req.user.id);
      await invalidateBounty(req.params.id);
      res.json(updated);
    } catch (error) {
      console.error("Error updating bounty:", error);
      res.status(500).json({ error: "Failed to update bounty" });
    }
  },
);

// ─── Approve bounty (Admin) ───────────────────────────────────────────────────
router.patch("/:id/approve", authenticate, isAdmin, async (req, res) => {
  try {
    const updated = await prisma.bounty.update({
      where: { id: req.params.id },
      data: { approved: true },
      include: BOUNTY_INCLUDE,
    });
    sendRealtimeUpdate("bounty_approved", updated, req.user.id);
    await invalidateBounty(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to approve bounty" });
  }
});

// ─── Change status (Admin) ────────────────────────────────────────────────────
router.patch("/:id/status", authenticate, isAdmin, async (req, res) => {
  try {
    const { status, winnerId } = req.body;
    const bountyId = req.params.id;

    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: {
        id: true,
        status: true,
        assignee: true,
        assignees: { select: { userId: true } },
      },
    });

    if (!bounty) return res.status(404).json({ error: "Bounty not found" });

    const isApproved = !["CANCELLED", "TO_DO"].includes(status);
    let paymentAssigneeId = bounty.assignee;

    if (status === "DONE") {
      const count = bounty.assignees.length;
      if (count === 1) {
        paymentAssigneeId = bounty.assignees[0].userId;
      } else if (count > 1) {
        if (!winnerId) {
          return res.status(400).json({
            error: "Winner selection required",
            requiresWinner: true,
            assignees: bounty.assignees,
          });
        }
        if (!bounty.assignees.some((a) => a.userId === winnerId)) {
          return res
            .status(400)
            .json({ error: "Selected winner is not an assignee" });
        }
        paymentAssigneeId = winnerId;
      }
    }

    const updated = await prisma.bounty.update({
      where: { id: bountyId },
      data: {
        status,
        isApproved,
        ...(status === "DONE" && { assignee: paymentAssigneeId }),
      },
      include: BOUNTY_INCLUDE,
    });

    sendRealtimeUpdate("bounty_status_changed", updated, req.user.id);
    await invalidateBounty(bountyId);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update bounty status" });
  }
});

// ─── Submit work ──────────────────────────────────────────────────────────────
router.post("/:id/submit", authenticate, async (req, res) => {
  try {
    const { id: bountyId } = req.params;
    const { description, deliverableUrl } = req.body;
    const userId = req.user.id;

    if (!description?.trim()) {
      return res.status(400).json({ error: "Work description is required" });
    }

    // 🔥 Single query: bounty + assignment check + existing submission check
    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: {
        id: true,
        isApproved: true,
        status: true,
        createdBy: true,
        assignees: {
          where: { userId },
          select: { userId: true },
        },
        workSubmissions: {
          where: {
            submittedBy: userId,
            status: { in: ["pending", "approved"] },
          },
          select: { id: true },
        },
        _count: {
          select: {
            assignees: true, // total assignees
          },
        },
      },
    });

    if (!bounty) {
      return res.status(404).json({ error: "Bounty not found" });
    }

    const isAssigned = bounty.assignees.length > 0;

    if (!isAssigned) {
      return res
        .status(403)
        .json({ error: "You are not assigned to this bounty" });
    }

    if (!bounty.isApproved) {
      return res
        .status(400)
        .json({ error: "Bounty must be approved before submitting work" });
    }

    if (!["TO_DO", "IN_PROGRESS", "IN_REVIEW"].includes(bounty.status)) {
      return res.status(400).json({
        error: "Work cannot be submitted for bounties in this status",
      });
    }

    if (bounty.workSubmissions.length > 0) {
      return res.status(400).json({
        error: "You have already submitted work for this bounty",
      });
    }

    // 🔥 Only remaining query needed
    const existingSubmissions = await prisma.workSubmission.count({
      where: {
        bountyId,
        status: { in: ["pending", "approved"] },
      },
    });

    const totalAssignees = bounty._count.assignees;

    // same logic as before
    const allSubmitted = existingSubmissions + 1 >= totalAssignees;
    const newBountyStatus = allSubmitted ? "IN_REVIEW" : "IN_PROGRESS";

    const [workSubmission, updatedBounty] = await prisma.$transaction([
      prisma.workSubmission.create({
        data: {
          bountyId,
          submittedBy: userId,
          description: description.trim(),
          deliverableUrl: deliverableUrl?.trim() || null,
          status: "pending",
        },
        include: {
          submitterUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      }),
      prisma.bounty.update({
        where: { id: bountyId },
        data: { status: newBountyStatus },
        include: BOUNTY_INCLUDE, // lean — no workSubmissions join here
      }),
    ]);

    sendRealtimeUpdate("work_submitted", workSubmission, userId);
    sendRealtimeUpdate("bounty_updated", updatedBounty, userId);

    res.json({
      message: "Work submitted successfully",
      workSubmission,
      bounty: updatedBounty,
    });
  } catch (error) {
    console.error("Error submitting work:", error);
    res.status(500).json({
      error: "Failed to submit work",
      details: error.message,
    });
  }
});

// ─── Get submissions (creator / admin) ───────────────────────────────────────
router.get("/:id/submissions", authenticate, async (req, res) => {
  try {
    const { id: bountyId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Fetch bounty + check if user is assignee in ONE query
    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: {
        id: true,
        createdBy: true,
        assignees: {
          where: { userId },
          select: { userId: true },
        },
      },
    });

    if (!bounty) {
      return res.status(404).json({ error: "Bounty not found" });
    }

    const isOwner = bounty.createdBy === userId;
    const isAdmin = userRole === "ADMIN";
    const isAssignee = bounty.assignees.length > 0;

    if (!isOwner && !isAdmin && !isAssignee) {
      return res.status(403).json({
        error: "You do not have permission to view submissions",
      });
    }

    const submissions = await prisma.workSubmission.findMany({
      where: {
        bountyId,
        ...(isAssignee && !isOwner && !isAdmin ? { submittedBy: userId } : {}),
      },
      include: {
        submitterUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { submittedAt: "desc" },
    });

    res.json(
      submissions.map((s) => ({
        ...s,
        attachments: s.attachments ? JSON.parse(s.attachments) : [],
      })),
    );
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

router.get("/submissions/all", authenticate, isAdmin, async (req, res) => {
  try {
    const submissions = await prisma.workSubmission.findMany({
      include: {
        submitterUser: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
      orderBy: { submittedAt: "desc" },
    });
    res.json(submissions);
  } catch (error) {
    console.error("Error fetching all submissions:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

// ─── Review submission ────────────────────────────────────────────────────────
router.patch(
  "/submissions/:submissionId/review",
  authenticate,
  async (req, res) => {
    try {
      const { submissionId } = req.params;
      const { status, reviewNotes } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      if (!["approved", "rejected", "needs_revision"].includes(status)) {
        return res.status(400).json({ error: "Invalid review status" });
      }

      // ✅ Single query: submission + bounty + submitter
      const submission = await prisma.workSubmission.findUnique({
        where: { id: submissionId },
        include: {
          bounty: {
            select: { id: true, createdBy: true, status: true },
          },
          submitterUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (!submission) {
        return res.status(404).json({ error: "Submission not found" });
      }

      if (submission.bounty.createdBy !== userId && userRole !== "ADMIN") {
        return res.status(403).json({
          error: "You do not have permission to review this submission",
        });
      }

      let newBountyStatus = submission.bounty.status;

      // ✅ Slightly cleaner + more explicit than findFirst
      if (status === "approved") {
        newBountyStatus = "DONE";
      } else if (status === "rejected" || status === "needs_revision") {
        const approvedCount = await prisma.workSubmission.count({
          where: {
            bountyId: submission.bounty.id,
            status: "approved",
            id: { not: submissionId },
          },
        });

        if (approvedCount === 0) {
          newBountyStatus = "IN_PROGRESS";
        }
      }

      const [updatedSubmission, updatedBounty] = await prisma.$transaction(
        async (tx) => {
          const updSub = await tx.workSubmission.update({
            where: { id: submissionId },
            data: {
              status,
              reviewNotes: reviewNotes?.trim() || null,
              reviewedBy: userId,
              reviewedAt: new Date(),
            },
            include: {
              submitterUser: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
              reviewerUser: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          });

          if (status === "approved") {
            await tx.workSubmission.updateMany({
              where: {
                bountyId: submission.bounty.id,
                id: { not: submissionId },
                status: "pending",
              },
              data: { status: "rejected" },
            });
          }

          const updBounty = await tx.bounty.update({
            where: { id: submission.bounty.id },
            data: {
              status: newBountyStatus,
              ...(status === "approved" && {
                assignee: submission.submittedBy,
              }),
            },
            include: BOUNTY_INCLUDE,
          });

          if (status === "approved") {
            await tx.bountyAssignee.deleteMany({
              where: {
                bountyId: submission.bounty.id,
                userId: { not: submission.submittedBy },
              },
            });
          }

          // ❌ REMOVED finalBounty (unused + wasteful)

          return [updSub, updBounty];
        },
      );

      sendRealtimeUpdate("submission_reviewed", updatedSubmission, userId);
      sendRealtimeUpdate("bounty_updated", updatedBounty, userId);

      res.json({
        message: "Submission reviewed successfully",
        submission: updatedSubmission,
        bounty: updatedBounty,
      });
    } catch (error) {
      console.error("Error reviewing submission:", error);
      res.status(500).json({ error: "Failed to review submission" });
    }
  },
);

// ─── Fetch all users ──────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const cacheKey = "users:all";
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        z_address: true,
        avatar: true,
      },
    });
    await setCache(cacheKey, users, TTL.USERS);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Switch role ──────────────────────────────────────────────────────────────
router.patch("/switch-role", authenticate, async (req, res) => {
  try {
    const { role } = req.body;
    if (!["ADMIN", "CLIENT"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, isRobin: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.isRobin)
      return res.status(403).json({ error: "Role switching not permitted" });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { role },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        isRobin: true,
        isManOfSteel: true,
        z_address: true,
      },
    });
    await delCache("users:all");
    res.json({ user: updated });
  } catch (error) {
    console.error("Failed to switch role:", error);
    res.status(500).json({ error: "Failed to switch role" });
  }
});

// ─── My applications ──────────────────────────────────────────────────────────
router.get("/my-applications", authenticate, async (req, res) => {
  try {
    const cacheKey = `applications:user:${req.user.id}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);
    const applications = await prisma.bountyApplication.findMany({
      where: { applicantId: req.user.id },
      include: {
        bounty: {
          select: {
            id: true,
            title: true,
            bountyAmount: true,
            status: true,
            timeToComplete: true,
          },
        },
      },
      orderBy: { appliedAt: "desc" },
    });
    await setCache(cacheKey, applications, TTL.APPLICATIONS);
    res.json(applications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── All applications (Admin) ─────────────────────────────────────────────────
router.get("/all-applications", authenticate, isAdmin, async (req, res) => {
  try {
    const cacheKey = "applications:all";
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);
    const applications = await prisma.bountyApplication.findMany({
      include: {
        bounty: {
          select: {
            id: true,
            title: true,
            bountyAmount: true,
            status: true,
            timeToComplete: true,
          },
        },
      },
      orderBy: { appliedAt: "desc" },
    });
    await setCache(cacheKey, applications, TTL.APPLICATIONS);
    res.json(applications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────
router.get("/categories", async (req, res) => {
  try {
    const cacheKey = "categories:all";
    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const categories = await prisma.bountyCategory.findMany({
      orderBy: { name: "asc" },
    });
    await setCache(cacheKey, categories, TTL.CATEGORIES);
    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.post("/categories", authenticate, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim())
      return res.status(400).json({ error: "Category name is required" });

    const existing = await prisma.bountyCategory.findUnique({
      where: { name: name.trim() },
    });
    if (existing)
      return res.status(400).json({ error: "Category already exists" });

    const category = await prisma.bountyCategory.create({
      data: { name: name.trim() },
    });
    await delCache("categories:all");
    sendRealtimeUpdate("category_created", category, req.user.id);
    res.status(201).json(category);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: "Failed to create category" });
  }
});

router.put(
  "/categories/:categoriesId",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { categoriesId } = req.params;
      const { name } = req.body;
      if (!name?.trim())
        return res.status(400).json({ error: "Category name is required" });

      const existing = await prisma.bountyCategory.findFirst({
        where: { name: name.trim(), id: { not: parseInt(categoriesId) } },
      });
      if (existing)
        return res.status(400).json({ error: "Category name already exists" });

      const category = await prisma.bountyCategory.update({
        where: { id: parseInt(categoriesId) },
        data: { name: name.trim() },
      });
      await delCache("categories:all");
      sendRealtimeUpdate("category_updated", category, req.user.id);
      res.json(category);
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ error: "Failed to update category" });
    }
  },
);

router.delete(
  "/categories/:categoriesId",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const id = parseInt(req.params.categoriesId);

      const category = await prisma.bountyCategory.findUnique({
        where: { id },
        include: { bounties: { select: { id: true } } },
      });
      if (!category)
        return res.status(404).json({ error: "Category not found" });
      if (category.bounties.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with existing bounties",
          bountyCount: category.bounties.length,
        });
      }

      await prisma.bountyCategory.delete({ where: { id } });
      await delCache("categories:all");
      sendRealtimeUpdate("category_deleted", { id }, req.user.id);
      res.json({ message: "Category deleted successfully" });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: "Failed to delete category" });
    }
  },
);

// ─── Applications for a bounty (admin / creator) ──────────────────────────────
router.get("/:bountyId/applications", authenticate, async (req, res) => {
  try {
    const { bountyId } = req.params;
    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: { id: true, createdBy: true },
    });
    if (!bounty) return res.status(404).json({ error: "Bounty not found" });
    if (req.user.role !== "ADMIN" && bounty.createdBy !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    const applications = await prisma.bountyApplication.findMany({
      where: { bountyId },
      include: {
        applicantUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { appliedAt: "desc" },
    });
    res.json(applications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Update application status (Admin) ───────────────────────────────────────
router.put(
  "/applications/:applicationId",
  authenticate,
  isAdmin,
  async (req, res) => {
    try {
      const { applicationId } = req.params;
      const { status } = req.body;

      const application = await prisma.bountyApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, bountyId: true, applicantId: true },
      });
      if (!application)
        return res.status(404).json({ error: "Application not found" });

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.bountyApplication.update({
          where: { id: applicationId },
          data: { status, reviewedAt: new Date(), reviewedBy: req.user.id },
          include: {
            applicantUser: { select: { id: true, name: true, email: true } },
          },
        });

        if (status === "accepted") {
          await tx.bountyAssignee.upsert({
            where: {
              bountyId_userId: {
                bountyId: application.bountyId,
                userId: application.applicantId,
              },
            },
            update: {},
            create: {
              bountyId: application.bountyId,
              userId: application.applicantId,
            },
          });
          await tx.bounty.update({
            where: { id: application.bountyId },
            data: { status: "IN_PROGRESS" },
          });
        }
        return updated;
      });
      await invalidateApplications(application.applicantId);
      await invalidateBounty(application.bountyId);

      sendRealtimeUpdate("application_updated", result, req.user.id);
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── Withdraw application (applicant only) ────────────────────────────────────
router.delete(
  "/applications/:applicationId",
  authenticate,
  async (req, res) => {
    try {
      const { applicationId } = req.params;

      const application = await prisma.bountyApplication.findUnique({
        where: { id: applicationId },
        select: { id: true, applicantId: true, status: true, bountyId: true },
      });
      if (!application)
        return res.status(404).json({ error: "Application not found" });
      if (application.applicantId !== req.user.id)
        return res.status(403).json({ error: "Access denied" });
      if (application.status !== "pending")
        return res
          .status(400)
          .json({ error: "Cannot withdraw a reviewed application" });

      await prisma.bountyApplication.delete({ where: { id: applicationId } });
      await invalidateApplications(application.applicantId);
      await invalidateBounty(application.bountyId);
      sendRealtimeUpdate(
        "application_deleted",
        { id: applicationId, bountyId: application.bountyId },
        req.user.id,
      );
      res.json({ message: "Application withdrawn successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── Apply to bounty ──────────────────────────────────────────────────────────
router.post("/apply", authenticate, async (req, res) => {
  try {
    const { bountyId, applicantId, message } = req.body;

    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      select: { id: true, assignee: true, createdBy: true },
    });
    if (!bounty) return res.status(404).json({ error: "Bounty not found" });
    if (bounty.assignee)
      return res.status(400).json({ error: "Bounty already assigned" });
    if (bounty.createdBy === applicantId)
      return res.status(400).json({ error: "Cannot apply to your own bounty" });

    const existing = await prisma.bountyApplication.findUnique({
      where: { bountyId_applicantId: { bountyId, applicantId } },
      select: { id: true },
    });
    if (existing)
      return res
        .status(400)
        .json({ error: "You have already applied to this bounty" });

    const application = await prisma.bountyApplication.create({
      data: { bountyId, applicantId, message: message.trim() },
      include: {
        bounty: { select: { id: true, title: true, bountyAmount: true } },
        applicantUser: { select: { id: true, name: true, email: true } },
      },
    });
    await invalidateApplications(applicantId);
    await invalidateBounty(application.bountyId);

    sendRealtimeUpdate("application_created", application, applicantId);
    res.status(201).json(application);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Export payments (Admin) ──────────────────────────────────────────────────
router.get("/export-payments", authenticate, isAdmin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(new Date(to).setHours(23, 59, 59, 999));

    const bounties = await prisma.bounty.findMany({
      where: { isPaid: true, ...(from || to ? { paidAt: dateFilter } : {}) },
      include: {
        assigneeUser: {
          select: {
            id: true,
            name: true,
            email: true,
            z_address: true,
            ofacVerified: true,
          },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                z_address: true,
                ofacVerified: true,
              },
            },
          },
        },
      },
      orderBy: { paidAt: "desc" },
    });

    res.json({ success: true, data: bounties });
  } catch (error) {
    console.error("Error fetching export data:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch export data" });
  }
});

router.get("/stats/totals", async (req, res) => {
  try {
    const cacheKey = "stats:totals";

    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const [totalAmountResult, countResult] = await Promise.all([
      prisma.bounty.aggregate({
        _sum: { bountyAmount: true },
        _count: { id: true },
      }),
      prisma.bounty.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
    ]);

    const statusCounts = countResult.reduce((acc, row) => {
      acc[row.status] = row._count.id;
      return acc;
    }, {});

    const result = {
      totalBountyAmount: totalAmountResult._sum.bountyAmount ?? 0,
      totalBountyCount: totalAmountResult._count.id,
      statusCounts,
    };

    await setCache(cacheKey, result, 60);

    res.json(result);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ─── Get single bounty ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const bountyId = req.params.id;
    const cacheKey = `bounty:${bountyId}`;

    const cached = await getCache(cacheKey);
    if (cached) return res.json(cached);

    const bounty = await prisma.bounty.findUnique({
      where: { id: bountyId },
      include: BOUNTY_INCLUDE, // was missing createdByUser entirely
    });

    if (!bounty) return res.status(404).json({ error: "Bounty not found" });

    await setCache(cacheKey, bounty, TTL.BOUNTY_SINGLE);

    res.json(bounty);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch bounty" });
  }
});

// ─── Edit bounty (Admin) ──────────────────────────────────────────────────────
router.put("/:id", authenticate, isAdmin, async (req, res) => {
  try {
    const updated = await prisma.bounty.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.title && { title: req.body.title }),
        ...(req.body.description && { description: req.body.description }),
        ...(req.body.bountyAmount && { bountyAmount: req.body.bountyAmount }),
        ...(req.body.timeToComplete && {
          timeToComplete: req.body.timeToComplete,
        }),
        ...(req.body.assignee !== undefined && { assignee: req.body.assignee }),
        ...(req.body.isApproved !== undefined && {
          isApproved: req.body.isApproved,
          status: req.body.isApproved ? "IN_PROGRESS" : "CANCELLED",
        }),
      },
      include: BOUNTY_INCLUDE,
    });

    sendRealtimeUpdate("bounty_updated", updated, req.user.id);
    await invalidateBounty(req.params.id);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update bounty" });
  }
});

module.exports = router;
