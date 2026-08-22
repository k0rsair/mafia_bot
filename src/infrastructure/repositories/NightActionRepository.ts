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
    targetPlayerId: string | null;
  }>): Promise<NightAction> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.upsertAction] Saving night action');
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

    this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.upsertAction] Night action saved');
    return action;
  }

  public async upsertMafiaDraft(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actorPlayerId: string;
    targetPlayerId: string | null;
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

  public async getLatestTarget(input: Readonly<{
    gameId: string;
    actorPlayerId: string;
    actionType: NightActionType;
  }>): Promise<string | null> {
    this.logger.debug({ gameId: input.gameId }, '[NightActionRepository.getLatestTarget] Loading latest action target');
    const action = await this.prisma.nightAction.findFirst({
      where: {
        gameId: input.gameId,
        actorPlayerId: input.actorPlayerId,
        actionType: toDbActionType(input.actionType),
        targetPlayerId: { not: null },
      },
      orderBy: [{ phaseVersion: 'desc' }, { createdAt: 'desc' }],
      select: { targetPlayerId: true },
    });
    return action?.targetPlayerId ?? null;
  }

  public async hasDoctorUsedSelfSave(gameId: string, playerId: string): Promise<boolean> {
    this.logger.debug({ gameId }, '[NightActionRepository.hasDoctorUsedSelfSave] Checking self-save history');
    const count = await this.prisma.nightAction.count({
      where: {
        gameId,
        actorPlayerId: playerId,
        targetPlayerId: playerId,
        actionType: DbNightActionType.DOCTOR_SAVE,
      },
    });
    return count > 0;
  }

  public async createRestrictedSingleUseAction(input: Readonly<{
    gameId: string;
    phaseVersion: number;
    actionType: NightActionType;
    actorPlayerId: string;
    targetPlayerId: string;
    rejectRepeatedTarget: boolean;
    rejectRepeatedSelfSave: boolean;
  }>): Promise<Readonly<{ action: NightAction | null; rejection: 'DUPLICATE' | 'REPEATED_TARGET' | 'SELF_SAVE_USED' | null }>> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.createRestrictedSingleUseAction] Creating restricted action');

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const databaseActionType = toDbActionType(input.actionType);
        if (input.rejectRepeatedTarget) {
          const latestAction = await transaction.nightAction.findFirst({
            where: {
              gameId: input.gameId,
              actorPlayerId: input.actorPlayerId,
              actionType: databaseActionType,
              phaseVersion: { lt: input.phaseVersion },
            },
            orderBy: [{ phaseVersion: 'desc' }, { createdAt: 'desc' }],
            select: { targetPlayerId: true },
          });
          if (latestAction?.targetPlayerId === input.targetPlayerId) {
            this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.createRestrictedSingleUseAction] Rejected repeated target');
            return { action: null, rejection: 'REPEATED_TARGET' };
          }
        }

        if (input.rejectRepeatedSelfSave && input.actorPlayerId === input.targetPlayerId) {
          const priorSelfSave = await transaction.nightAction.findFirst({
            where: {
              gameId: input.gameId,
              actorPlayerId: input.actorPlayerId,
              targetPlayerId: input.targetPlayerId,
              actionType: databaseActionType,
            },
            select: { id: true },
          });
          if (priorSelfSave !== null) {
            this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.createRestrictedSingleUseAction] Rejected repeated self-save');
            return { action: null, rejection: 'SELF_SAVE_USED' };
          }
        }

        const action = await transaction.nightAction.create({
          data: {
            gameId: input.gameId,
            phaseVersion: input.phaseVersion,
            actionType: databaseActionType,
            actorPlayerId: input.actorPlayerId,
            targetPlayerId: input.targetPlayerId,
          },
        });
        this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.createRestrictedSingleUseAction] Restricted action recorded');
        return { action, rejection: null };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[NightActionRepository.createRestrictedSingleUseAction] Rejected duplicate action');
        return { action: null, rejection: 'DUPLICATE' };
      }
      this.logger.error({ gameId: input.gameId, phaseVersion: input.phaseVersion, error }, '[NightActionRepository.createRestrictedSingleUseAction] Failed to create restricted action');
      throw error;
    }
  }
}

function toDbActionType(actionType: NightActionType): DbNightActionType {
  const databaseActionType = DbNightActionType[actionType as keyof typeof DbNightActionType];
  if (databaseActionType === undefined) {
    throw new Error(`Night action ${actionType} is not available in the current database schema`);
  }
  return databaseActionType;
}
