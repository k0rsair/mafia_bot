ALTER TABLE "NightAction" ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- Existing mafia actions were submitted before the explicit confirmation flow.
-- Keep their current in-progress night behaviour when this migration is deployed.
UPDATE "NightAction"
SET "confirmedAt" = "updatedAt"
WHERE "actionType" = 'MAFIA_KILL';
