import { NightActionType as DbNightActionType, type NightAction, type PrismaClient } from '@prisma/client';

import type { NightActionType } from '../../domain/game/types.js';
import type { AppLogger } from '../../observability/logger.js';

export class NightActionRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async upsertAction(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actionType: NightActionType;
    actorPlayerId: string;
    targetPlayerId: string;
  }>): Promise<NightAction> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion, actionType: input.actionType }, '[NightActionRepository.upsertAction] Saving night action');
    const action = await this.prisma.nightAction.upsert({
      where: {
        gameId_phaseVersion_actorPlayerId_actionType: {
          gameId: input.gameId,
          phaseVersion: input.phaseVersion,
          actorPlayerId: input.actorPlayerId,
          actionType: toDbActionType(input.actionType),
        },
      },
      create: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        actionType: toDbActionType(input.actionType),
        actorPlayerId: input.actorPlayerId,
        targetPlayerId: input.targetPlayerId,
      },
      update: { targetPlayerId: input.targetPlayerId },
    });

    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion, actionType: input.actionType }, '[NightActionRepository.upsertAction] Night action saved');
    return action;
  }

  public async listActions(gameId: string, phaseVersion: number): Promise<NightAction[]> {
    this.logger.debug({ gameId, phaseVersion }, '[NightActionRepository.listActions] Loading night actions');
    return this.prisma.nightAction.findMany({ where: { gameId, phaseVersion } });
  }
}

function toDbActionType(actionType: NightActionType): DbNightActionType {
  return DbNightActionType[actionType];
}
