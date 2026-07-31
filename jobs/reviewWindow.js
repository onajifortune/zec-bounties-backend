const prisma = require("../prisma/client");
const sendMail = require("../utils/sendMail");
const { sendRealtimeUpdate } = require("../middleware/websocket");
const {
  getCache,
  setCache,
  deleteCacheByPattern,
  delCache,
} = require("../utils/cache");

const DEFAULT_REVIEW_WINDOW_DAYS = 7; // Superteam's typical review window is 3-7 days

const CREATOR_SELECT = {
  id: true,
  name: true,
  nickname: true,
  email: true,
};

// helper — same invalidation shape as bounty.js, kept local so this job
// has no dependency on the route file
const invalidateBounty = async (bountyId) => {
  await Promise.all([
    delCache(`bounty:${bountyId}`),
    delCache("stats:totals"),
    deleteCacheByPattern("bounties:*"),
  ]);
};

// ─── Job 1: move expired BOUNTY listings into review ──────────────────────────
async function closeExpiredBountySubmissions() {
  const now = new Date();

  const expired = await prisma.bounty.findMany({
    where: {
      listingType: "BOUNTY",
      status: { in: ["TO_DO", "IN_PROGRESS"] },
      timeToComplete: { lt: now },
    },
    select: {
      id: true,
      title: true,
      createdByUser: { select: CREATOR_SELECT },
      workSubmissions: {
        where: { status: "pending" },
        select: { id: true },
      },
    },
  });

  if (expired.length === 0) return { closed: 0 };

  for (const bounty of expired) {
    const updated = await prisma.bounty.update({
      where: { id: bounty.id },
      data: { status: "IN_REVIEW" },
    });

    sendRealtimeUpdate("bounty_updated", updated, null);
    await invalidateBounty(bounty.id);

    const submissionCount = bounty.workSubmissions.length;
    const creator = bounty.createdByUser;

    if (creator?.email) {
      try {
        await sendMail({
          to: creator.email,
          subject: `Submissions closed: ${bounty.title}`,
          text: `Hi ${creator.nickname || creator.name},\n\nThe submission deadline for "${bounty.title}" has passed. ${submissionCount} submission(s) are waiting for review. Please select your winners.`,
          html: `
            <h2>Submissions closed</h2>
            <p>Hi ${creator.nickname || creator.name},</p>
            <p>The submission deadline for <strong>${bounty.title}</strong> has passed.</p>
            <p><strong>${submissionCount}</strong> submission(s) are waiting for review.</p>
            <p>Please select your winners when you get a chance.</p>
          `,
        });
      } catch (mailErr) {
        console.error(
          `[reviewWindow] Failed to send closure email for bounty ${bounty.id}:`,
          mailErr,
        );
      }
    }
  }

  return { closed: expired.length };
}

// ─── Job 2: remind creators of stale reviews ──────────────────────────────────
async function remindOverdueReviews() {
  const now = new Date();

  const inReview = await prisma.bounty.findMany({
    where: {
      listingType: "BOUNTY",
      status: "IN_REVIEW",
    },
    select: {
      id: true,
      title: true,
      timeToComplete: true,
      reviewWindowDays: true,
      createdByUser: { select: CREATOR_SELECT },
    },
  });

  let remindersSent = 0;

  for (const bounty of inReview) {
    const windowDays = bounty.reviewWindowDays ?? DEFAULT_REVIEW_WINDOW_DAYS;
    const reviewDeadline = new Date(bounty.timeToComplete);
    reviewDeadline.setDate(reviewDeadline.getDate() + windowDays);

    if (now < reviewDeadline) continue; // still inside the review window

    // Throttle to one reminder per bounty per calendar day
    const throttleKey = `review-reminder:${bounty.id}:${now.toISOString().slice(0, 10)}`;
    const alreadySent = await getCache(throttleKey);
    if (alreadySent) continue;

    const creator = bounty.createdByUser;
    if (creator?.email) {
      try {
        await sendMail({
          to: creator.email,
          subject: `Reminder: winners needed for ${bounty.title}`,
          text: `Hi ${creator.nickname || creator.name},\n\nThe review window for "${bounty.title}" has passed and winners haven't been selected yet. Submitters are waiting on you — please select winners when you can.`,
          html: `
            <h2>Winners still needed</h2>
            <p>Hi ${creator.nickname || creator.name},</p>
            <p>The review window for <strong>${bounty.title}</strong> has passed and winners haven't been selected yet.</p>
            <p>Submitters are waiting on you — please select winners when you can.</p>
          `,
        });
        // TTL 25h so it can't fire twice even across a slow-running cron tick
        await setCache(throttleKey, true, 25 * 60 * 60);
        remindersSent += 1;
      } catch (mailErr) {
        console.error(
          `[reviewWindow] Failed to send reminder email for bounty ${bounty.id}:`,
          mailErr,
        );
      }
    }
  }

  return { remindersSent };
}

module.exports = { closeExpiredBountySubmissions, remindOverdueReviews };
