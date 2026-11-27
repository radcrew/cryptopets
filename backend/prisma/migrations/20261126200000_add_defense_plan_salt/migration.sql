-- Defence plan version 2 (decision D9 in docs/plan-team-battles-3v3.md): a random 32-byte salt
-- the defender's client puts in the signed plan, so the public plan hash cannot be matched by
-- trying every roster. Null for a version 1 plan, which was signed without one.
--
-- No new table, so no row level security statement: "defense_plan" already has it enabled.
ALTER TABLE "defense_plan" ADD COLUMN "salt" TEXT;
