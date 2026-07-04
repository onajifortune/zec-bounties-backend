import Database from "better-sqlite3";
import { PrismaClient, Prisma } from "@prisma/client";

const sqlite = new Database("./prisma/dev.db", { readonly: true });
const prisma = new PrismaClient();

/**
 * Build a lookup of every model and its field types.
 */
const modelFields = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [model.name, model.fields]),
);

function normalize(modelName: string, row: any) {
  const fields = modelFields.get(modelName);

  if (!fields) return row;

  const data: any = {};

  for (const field of fields) {
    const value = row[field.name];

    if (value === undefined) continue;

    if (value === null) {
      data[field.name] = null;
      continue;
    }

    switch (field.type) {
      case "DateTime":
        // SQLite stores DateTime as integer milliseconds
        data[field.name] =
          typeof value === "number" ? new Date(value) : new Date(String(value));
        break;

      case "Boolean":
        data[field.name] = Boolean(value);
        break;

      default:
        data[field.name] = value;
    }
  }

  return data;
}

async function migrateTable(
  sqliteTable: string,
  modelName: string,
  create: (data: any) => Promise<any>,
) {
  const rows = sqlite.prepare(`SELECT * FROM ${sqliteTable}`).all();

  console.log(`Migrating ${sqliteTable} -> ${modelName} (${rows.length} rows)`);

  for (const row of rows) {
    await create(normalize(modelName, row));
  }

  console.log(`✓ ${sqliteTable}`);
}

async function main() {
  await migrateTable("User", "User", (data) => prisma.user.create({ data }));

  await migrateTable("bounty_categories", "BountyCategory", (data) =>
    prisma.bountyCategory.create({ data }),
  );

  await migrateTable("teams", "Team", (data) => prisma.team.create({ data }));

  await migrateTable("team_wallets", "TeamWallet", (data) =>
    prisma.teamWallet.create({ data }),
  );

  await migrateTable("team_members", "TeamMember", (data) =>
    prisma.teamMember.create({ data }),
  );

  await migrateTable("Bounty", "Bounty", (data) =>
    prisma.bounty.create({ data }),
  );

  await migrateTable("bounty_assignees", "BountyAssignee", (data) =>
    prisma.bountyAssignee.create({ data }),
  );

  await migrateTable("bounty_applications", "BountyApplication", (data) =>
    prisma.bountyApplication.create({ data }),
  );

  await migrateTable("work_submissions", "WorkSubmission", (data) =>
    prisma.workSubmission.create({ data }),
  );

  //   await migrateTable("Transaction", "Transaction", (data) =>
  //     prisma.transaction.create({ data }),
  //   );

  await migrateTable("zcash_params", "ZcashParams", (data) =>
    prisma.zcashParams.create({ data }),
  );

  console.log("🎉 Migration complete!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await prisma.$disconnect();
  });
