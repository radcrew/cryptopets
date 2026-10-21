-- Login challenges, moved out of process memory so any instance can verify a nonce another
-- one issued. Rows live five minutes; issuing a nonce deletes expired ones.
CREATE TABLE "auth_nonce" (
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_nonce_pkey" PRIMARY KEY ("nonce")
);

-- Expired rows are swept by expiry time on every issue.
CREATE INDEX "auth_nonce_expires_at_idx" ON "auth_nonce"("expires_at");

-- EnableRowLevelSecurity
--
-- Required on every new table (see CLAUDE.md). Without it, anyone holding the project's
-- public anon key could read live nonces and delete them. Enabled with no policies, like
-- every other table: the backend connects as the owner and bypasses RLS. Do NOT add FORCE.
ALTER TABLE "auth_nonce" ENABLE ROW LEVEL SECURITY;
