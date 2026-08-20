import { NightActionType as DbNightActionType, Prisma, type NightAction, type PrismaClient } from '@prisma/client';

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

  public async upsertMafiaDraft(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actorPlayerId: string;
    targetPlayerId: string;
  }>): Promise<NightAction> {
    const action = await this.prisma.nightAction.upsert({
      where: {
        gameId_phaseVersion_actorPlayerId_actionType: {
          gameId: input.gameId,
          phaseVersion: input.phaseVersion,
          actorPlayerId: input.actorPlayerId,
          actionType: DbNightActionType.MAFIA_KILL,
        },
      },
      create: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        actionType: DbNightActionType.MAFIA_KILL,
        actorPlayerId: input.actorPlayerId,
        targetPlayerId: input.targetPlayerId,
        confirmedAt: null,
      },
      update: {
        targetPlayerId: input.targetPlayerId,
        confirmedAt: null,
      },
    });
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[FIX:mafia-council] Mafia draft updated');
    return action;
  }

  public async confirmMafiaDraft(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actorPlayerId: string;
  }>): Promise<boolean> {
    const update = await this.prisma.nightAction.updateMany({
      where: {
        gameId: input.gameId,
        phaseVersion: input.phaseVersion,
        actorPlayerId: input.actorPlayerId,
        actionType: DbNightActionType.MAFIA_KILL,
        confirmedAt: null,
      },
      data: { confirmedAt: new Date() },
    });
    const confirmed = update.count === 1;
    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion, confirmed }, '[FIX:mafia-council] Mafia draft confirmation requested');
    return confirmed;
  }

  public async createSingleUseAction(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actionType: NightActionType;
    actorPlayerId: string;
    targetPlayerId: string;
  }>): Promise<NightAction | null> {
    try {
      const action = await this.prisma.nightAction.create({
        data: {
          gameId: input.gameId,
          phaseVersion: input.phaseVersion,
          actionType: toDbActionType(input.actionType),
          actorPlayerId: input.actorPlayerId,
          targetPlayerId: input.targetPlayerId,
        },
      });
      this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[FIX:single-use-night-action] Single-use night action recorded');
      return action;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[FIX:single-use-night-action] Rejected duplicate single-use night action');
        return null;
      }
      this.logger.error({ gameId: input.gameId, phaseVersion: input.phaseVersion, error }, '[FIX:single-use-night-action] Failed to record single-use night action');
      throw error;
    }
  }

  public async listActions(gameId: string, phaseVersion: number): Promise<NightAction[]> {
    this.logger.debug({ gameId, phaseVersion }, '[NightActionRepository.listActions] Loading night actions');
    return this.prisma.nightAction.findMany({ where: { gameId, phaseVersion } });
  }
}

function toDbActionType(actionType: NightActionType): DbNightActionType {
  return DbNightActionType[actionType];
}
