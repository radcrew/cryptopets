-- Team battles (docs/plan-team-battles-3v3.md, Phase 4).
--
-- A team battle runs through the same state machine, outbox and workers as a duel, so it lives
-- in the same ledger, intent and receipt tables, marked by a new "kind" column. What differs
-- moves into nullable columns and three new tables:
--
-- - defense_plan and defense_plan_usage: a defender's signed five-pet roster and its daily
--   counter, the team counterparts of defense_authorization and defense_usage.
-- - battle_receipt_fighter: a team receipt's six fighters, so a pet's receipt chain stays an
--   indexed lookup, as the duel receipt's two pet columns make it for duels.
--
-- Nothing is dropped or rewritten. Every existing row gets kind = 'duel', and the duel-only
-- columns stay filled on every duel by the CHECK constraints at the end, so relaxing NOT NULL
-- cannot let a malformed duel in. Both consent links keep ON DELETE RESTRICT: receipts name
-- these hashes, so the rows must outlive any attempt to delete them.

-- AlterTable
ALTER TABLE "battle_intent" ADD COLUMN     "attackers" JSONB,
ADD COLUMN     "defense_plan_hash" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'duel',
ALTER COLUMN "attacker_pet_id" DROP NOT NULL,
ALTER COLUMN "defender_pet_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "battle_ledger" ADD COLUMN     "defense_plan_hash" TEXT,
ADD COLUMN     "drawn" JSONB,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'duel',
ALTER COLUMN "authorization_hash" DROP NOT NULL,
ALTER COLUMN "attacker_pet_id" DROP NOT NULL,
ALTER COLUMN "defender_pet_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "battle_receipt" ALTER COLUMN "attacker_pet_id" DROP NOT NULL,
ALTER COLUMN "defender_pet_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "defense_plan" (
    "plan_hash" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "defender_owner" TEXT NOT NULL,
    "roster" JSONB NOT NULL,
    "ruleset_hash" TEXT NOT NULL,
    "min_level" INTEGER NOT NULL,
    "max_level" INTEGER NOT NULL,
    "max_battles_per_day" INTEGER NOT NULL,
    "not_before" BIGINT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "revocation_nonce" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "signature_format" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "defense_plan_pkey" PRIMARY KEY ("plan_hash")
);

-- CreateTable
CREATE TABLE "defense_plan_usage" (
    "plan_hash" TEXT NOT NULL,
    "day_bucket" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defense_plan_usage_pkey" PRIMARY KEY ("plan_hash","day_bucket")
);

-- CreateTable
CREATE TABLE "battle_receipt_fighter" (
    "receipt_hash" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "chain_id" TEXT NOT NULL,
    "pet_id" TEXT NOT NULL,
    "previous_receipt_hash" TEXT,

    CONSTRAINT "battle_receipt_fighter_pkey" PRIMARY KEY ("receipt_hash","position")
);

-- CreateIndex
CREATE INDEX "defense_plan_chain_id_deployment_id_defender_owner_idx" ON "defense_plan"("chain_id", "deployment_id", "defender_owner");

-- CreateIndex
CREATE INDEX "defense_plan_chain_id_deployment_id_ruleset_hash_idx" ON "defense_plan"("chain_id", "deployment_id", "ruleset_hash");

-- CreateIndex
CREATE INDEX "battle_receipt_fighter_chain_id_pet_id_idx" ON "battle_receipt_fighter"("chain_id", "pet_id");

-- CreateIndex
CREATE INDEX "battle_ledger_defense_plan_hash_idx" ON "battle_ledger"("defense_plan_hash");

-- AddForeignKey
ALTER TABLE "defense_plan_usage" ADD CONSTRAINT "defense_plan_usage_plan_hash_fkey" FOREIGN KEY ("plan_hash") REFERENCES "defense_plan"("plan_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_ledger" ADD CONSTRAINT "battle_ledger_defense_plan_hash_fkey" FOREIGN KEY ("defense_plan_hash") REFERENCES "defense_plan"("plan_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_receipt_fighter" ADD CONSTRAINT "battle_receipt_fighter_receipt_hash_fkey" FOREIGN KEY ("receipt_hash") REFERENCES "battle_receipt"("receipt_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- A duel keeps every column it always had; a team battle has its plan instead. Enforced here
-- rather than trusted to the application, because these columns were NOT NULL until now and
-- a duel row missing its pets would break every reader written against that guarantee.
ALTER TABLE "battle_intent" ADD CONSTRAINT "battle_intent_kind_shape" CHECK (
    ("kind" = 'duel' AND "attacker_pet_id" IS NOT NULL AND "defender_pet_id" IS NOT NULL
        AND "attackers" IS NULL AND "defense_plan_hash" IS NULL)
    OR ("kind" = 'team' AND "attacker_pet_id" IS NULL AND "defender_pet_id" IS NULL
        AND "attackers" IS NOT NULL AND "defense_plan_hash" IS NOT NULL)
);

ALTER TABLE "battle_ledger" ADD CONSTRAINT "battle_ledger_kind_shape" CHECK (
    ("kind" = 'duel' AND "authorization_hash" IS NOT NULL AND "attacker_pet_id" IS NOT NULL
        AND "defender_pet_id" IS NOT NULL AND "defense_plan_hash" IS NULL AND "drawn" IS NULL)
    OR ("kind" = 'team' AND "defense_plan_hash" IS NOT NULL AND "authorization_hash" IS NULL
        AND "attacker_pet_id" IS NULL AND "defender_pet_id" IS NULL)
);

-- EnableRowLevelSecurity
--
-- Required on every new table (see CLAUDE.md): Supabase grants each new table in "public" to
-- "anon" and "authenticated" with ALL privileges, so without this anyone holding the public
-- anon key could read every defender's roster and delete receipts' fighter rows. Enabled with
-- no policies, matching every other table; the backend connects as the owner and bypasses it.
-- Do NOT add FORCE.
ALTER TABLE "defense_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "defense_plan_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "battle_receipt_fighter" ENABLE ROW LEVEL SECURITY;
