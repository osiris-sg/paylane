-- One-shot grandfather: every Company that exists at the time this runs
-- is promoted to PAID. Run ONCE after `npm run db:push` adds the
-- sendingPlan column. New signups created after this point keep the
-- LOCKED default and must start a trial.
--
-- Run with:
--   npx prisma db execute --file ./scripts/grandfather-sending-plan.sql --schema ./prisma/schema.prisma

UPDATE "Company"
SET "sendingPlan" = 'PAID'
WHERE "sendingPlan" = 'LOCKED';
