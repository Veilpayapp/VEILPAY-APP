-- Pass B: ChainType mvm → xlm; optional invoice.token_address for ERC-20 identity.

-- 1) Rebuild ChainType enum without mvm, with xlm (Postgres cannot DROP VALUE).
ALTER TYPE "ChainType" RENAME TO "ChainType_old";

CREATE TYPE "ChainType" AS ENUM ('evm', 'svm', 'xlm');

-- Map legacy Aptos (mvm) rows to xlm so the cast succeeds; operators should
-- clean or re-publish those viewing keys. Other values pass through.
ALTER TABLE "chain_viewing_keys"
  ALTER COLUMN "chain_type" DROP DEFAULT,
  ALTER COLUMN "chain_type" TYPE "ChainType"
  USING (
    CASE
      WHEN "chain_type"::text = 'mvm' THEN 'xlm'::"ChainType"
      WHEN "chain_type"::text = 'xlm' THEN 'xlm'::"ChainType"
      WHEN "chain_type"::text = 'svm' THEN 'svm'::"ChainType"
      ELSE 'evm'::"ChainType"
    END
  );

DROP TYPE "ChainType_old";

-- 2) Persist expected token contract on invoices (null for native / legacy rows).
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "token_address" VARCHAR(100);
