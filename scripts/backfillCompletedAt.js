const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const bounties = await prisma.bounty.findMany({
    where: {
      status: "DONE",
      completedAt: null, // only backfill what's missing — safe to re-run
    },
    select: {
      id: true,
      paidAt: true,
      workSubmissions: {
        select: { status: true, reviewedAt: true },
      },
    },
  });

  console.log(`Found ${bounties.length} DONE bounties missing completedAt`);

  let fromPaidAt = 0;
  let fromReviewedAt = 0;
  let unresolved = 0;

  for (const bounty of bounties) {
    let estimate = null;
    let source = null;

    if (bounty.paidAt) {
      estimate = bounty.paidAt;
      source = "paidAt";
    } else {
      const approved = bounty.workSubmissions
        .filter((w) => w.status === "approved" && w.reviewedAt)
        .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt))[0];
      if (approved) {
        estimate = approved.reviewedAt;
        source = "reviewedAt";
      }
    }

    if (!estimate) {
      unresolved++;
      console.warn(`No signal for bounty ${bounty.id} — left completedAt null`);
      continue;
    }

    await prisma.bounty.update({
      where: { id: bounty.id },
      data: { completedAt: estimate },
    });

    if (source === "paidAt") fromPaidAt++;
    else fromReviewedAt++;
  }

  console.log(
    `Done. paidAt: ${fromPaidAt}, reviewedAt: ${fromReviewedAt}, unresolved: ${unresolved}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
