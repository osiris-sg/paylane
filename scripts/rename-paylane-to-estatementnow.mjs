// One-time data backfill: rewrite any stored, user-facing "PayLane" text left
// over from before the rename to "E-StatementNow". These live in DB rows that
// were written when the old brand string was in the code (e.g. the invoice
// timeline message "Invoice sent (customer not yet on PayLane)").
//
// Covers free-text columns the UI renders:
//   - TimelineItem.message
//   - Notification.message
//
// Idempotent — only selects rows that still contain "PayLane", so re-running is
// safe. Case-sensitive on the brand token; internal lowercase keys like
// "paylane:..." are NOT touched (they never reach the DB anyway).
//
// Run:  node --env-file=.env scripts/rename-paylane-to-estatementnow.mjs
//
// (Snapshot/branch the DB first if you want a rollback point — it rewrites text
// in place.)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OLD = "PayLane";
const NEW = "E-StatementNow";

async function rewrite(model, rows) {
  let changed = 0;
  for (const row of rows) {
    const next = row.message.split(OLD).join(NEW);
    if (next === row.message) continue;
    await prisma[model].update({ where: { id: row.id }, data: { message: next } });
    changed += 1;
    console.log(`  ${model} ${row.id}: "${row.message}" → "${next}"`);
  }
  return changed;
}

async function main() {
  const [timelineItems, notifications] = await Promise.all([
    prisma.timelineItem.findMany({
      where: { message: { contains: OLD } },
      select: { id: true, message: true },
    }),
    prisma.notification.findMany({
      where: { message: { contains: OLD } },
      select: { id: true, message: true },
    }),
  ]);

  console.log(
    `Found ${timelineItems.length} timeline item(s) and ${notifications.length} notification(s) containing "${OLD}".`,
  );

  const a = await rewrite("timelineItem", timelineItems);
  const b = await rewrite("notification", notifications);

  console.log(`Done. Rewrote ${a + b} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
