-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('LOBBY', 'RUNNING', 'FINISHED', 'CANCELLED');
CREATE TYPE "GamePhase" AS ENUM ('LOBBY', 'ROLE_CONFIRMATION', 'NIGHT', 'DAY_DISCUSSION', 'DAY_VOTE', 'FINISHED', 'CANCELLED');
CREATE TYPE "PlayerStatus" AS ENUM ('LOBBY', 'ALIVE', 'DEAD', 'LEFT');
CREATE TYPE "Role" AS ENUM ('MAFIA', 'COMMISSIONER', 'DOCTOR', 'CIVILIAN');
CREATE TYPE "NightActionType" AS ENUM ('MAFIA_KILL', 'DOCTOR_SAVE', 'COMMISSIONER_CHECK');
CREATE TYPE "PhaseJobKind" AS ENUM ('PHASE_DEADLINE');

-- CreateTable
CREATE TABLE "GameChat" (
  "id" TEXT NOT NULL,
  "title" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Game" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
  "phase" "GamePhase" NOT NULL DEFAULT 'LOBBY',
  "stateVersion" INTEGER NOT NULL DEFAULT 1,
  "phaseDeadline" TIMESTAMP(3),
  "lobbyMessageId" INTEGER,
  "controlMessageId" INTEGER,
  "activeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Player" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "username" TEXT,
  "status" "PlayerStatus" NOT NULL DEFAULT 'LOBBY',
  "role" "Role",
  "roleConfirmedAt" TIMESTAMP(3),
  "eliminatedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vote" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "phaseVersion" INTEGER NOT NULL,
  "voterPlayerId" TEXT NOT NULL,
  "targetPlayerId" TEXT,
  "isSkip" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NightAction" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "phaseVersion" INTEGER NOT NULL,
  "actionType" "NightActionType" NOT NULL,
  "actorPlayerId" TEXT NOT NULL,
  "targetPlayerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NightAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PhaseJob" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "phaseVersion" INTEGER NOT NULL,
  "kind" "PhaseJobKind" NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhaseJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_activeKey_key" ON "Game"("activeKey");
CREATE INDEX "Game_chatId_status_idx" ON "Game"("chatId", "status");
CREATE INDEX "Game_phaseDeadline_idx" ON "Game"("phaseDeadline");
CREATE UNIQUE INDEX "Player_gameId_userId_key" ON "Player"("gameId", "userId");
CREATE INDEX "Player_gameId_status_idx" ON "Player"("gameId", "status");
CREATE UNIQUE INDEX "Vote_gameId_phaseVersion_voterPlayerId_key" ON "Vote"("gameId", "phaseVersion", "voterPlayerId");
CREATE INDEX "Vote_gameId_phaseVersion_idx" ON "Vote"("gameId", "phaseVersion");
CREATE UNIQUE INDEX "NightAction_gameId_phaseVersion_actorPlayerId_actionType_key" ON "NightAction"("gameId", "phaseVersion", "actorPlayerId", "actionType");
CREATE INDEX "NightAction_gameId_phaseVersion_idx" ON "NightAction"("gameId", "phaseVersion");
CREATE UNIQUE INDEX "PhaseJob_gameId_phaseVersion_kind_key" ON "PhaseJob"("gameId", "phaseVersion", "kind");
CREATE INDEX "PhaseJob_dueAt_processedAt_idx" ON "PhaseJob"("dueAt", "processedAt");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "GameChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterPlayerId_fkey" FOREIGN KEY ("voterPlayerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_targetPlayerId_fkey" FOREIGN KEY ("targetPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_actorPlayerId_fkey" FOREIGN KEY ("actorPlayerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NightAction" ADD CONSTRAINT "NightAction_targetPlayerId_fkey" FOREIGN KEY ("targetPlayerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhaseJob" ADD CONSTRAINT "PhaseJob_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
