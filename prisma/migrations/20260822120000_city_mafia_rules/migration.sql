-- Extend the classic-Mafia schema without rewriting legacy enum values or game rows.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DON';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PROSTITUTE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANIAC';

ALTER TYPE "NightActionType" ADD VALUE IF NOT EXISTS 'PROSTITUTE_VISIT';
ALTER TYPE "NightActionType" ADD VALUE IF NOT EXISTS 'DON_CHECK';
ALTER TYPE "NightActionType" ADD VALUE IF NOT EXISTS 'MANIAC_KILL';
ALTER TYPE "NightActionType" ADD VALUE IF NOT EXISTS 'MANIAC_SKIP';

CREATE TYPE "VoteRoundKind" AS ENUM ('NOMINATION', 'PRIMARY', 'REVOTE', 'FINAL_DECISION');
CREATE TYPE "DayEffectKind" AS ENUM ('PROSTITUTE_ALIBI');

ALTER TABLE "NightAction" ALTER COLUMN "targetPlayerId" DROP NOT NULL;
ALTER TABLE "Vote" ADD COLUMN "voteRoundId" TEXT;

CREATE TABLE "VoteRound" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "phaseVersion" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "VoteRoundKind" NOT NULL,
    "candidatePlayerIds" TEXT[] NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "VoteRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DayEffect" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "kind" "DayEffectKind" NOT NULL,
    "phaseVersion" INTEGER NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayEffect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoteRound_gameId_phaseVersion_sequence_key" ON "VoteRound"("gameId", "phaseVersion", "sequence");
CREATE INDEX "VoteRound_gameId_phaseVersion_closedAt_idx" ON "VoteRound"("gameId", "phaseVersion", "closedAt");
CREATE UNIQUE INDEX "DayEffect_gameId_playerId_kind_phaseVersion_key" ON "DayEffect"("gameId", "playerId", "kind", "phaseVersion");
CREATE INDEX "DayEffect_gameId_kind_consumedAt_idx" ON "DayEffect"("gameId", "kind", "consumedAt");
CREATE INDEX "Vote_voteRoundId_idx" ON "Vote"("voteRoundId");

ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voteRoundId_fkey" FOREIGN KEY ("voteRoundId") REFERENCES "VoteRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoteRound" ADD CONSTRAINT "VoteRound_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayEffect" ADD CONSTRAINT "DayEffect_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayEffect" ADD CONSTRAINT "DayEffect_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
