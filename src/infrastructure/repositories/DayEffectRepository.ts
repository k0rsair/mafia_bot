import { DayEffectKind, Prisma, type PrismaClient } from '@prisma/client';

import type { AppLogger } from '../../observability/logger.js';

export class DayEffectRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async createProstituteAlibi(input: Readonly<{
    gameId: string;
    playerId: string;
    phaseVersion: number;
  }>): Promise<boolean> {
    this.logger.debug({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[DayEffectRepository.createProstituteAlibi] Recording day effect');
    try {
      await this.prisma.dayEffect.create({
        data: {
          gameId: input.gameId,
          playerId: input.playerId,
          phaseVersion: input.phaseVersion,
          kind: DayEffectKind.PROSTITUTE_ALIBI,
        },
      });
      this.logger.info({ gameId: input.gameId, phaseVersion: input.phaseVersion, effectCount: 1 }, '[DayEffectRepository.createProstituteAlibi] Day effect recorded');
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn({ gameId: input.gameId, phaseVersion: input.phaseVersion }, '[DayEffectRepository.createProstituteAlibi] Duplicate day effect ignored');
        return false;
      }
      this.logger.error({ gameId: input.gameId, phaseVersion: input.phaseVersion, error }, '[DayEffectRepository.createProstituteAlibi] Failed to record day effect');
      throw error;
    }
  }

  public async consumeProstituteAlibi(gameId: string, playerId: string): Promise<boolean> {
    this.logger.debug({ gameId }, '[DayEffectRepository.consumeProstituteAlibi] Consuming day effect');
    const update = await this.prisma.dayEffect.updateMany({
      where: {
        gameId,
        playerId,
        kind: DayEffectKind.PROSTITUTE_ALIBI,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    const consumed = update.count > 0;
    this.logger.info({ gameId, consumedEffectCount: update.count }, '[DayEffectRepository.consumeProstituteAlibi] Day effect consumption completed');
    return consumed;
  }

  public async listActiveProstituteAlibiPlayerIds(gameId: string): Promise<string[]> {
    this.logger.debug({ gameId }, '[DayEffectRepository.listActiveProstituteAlibiPlayerIds] Loading active day effects');
    const effects = await this.prisma.dayEffect.findMany({
      where: { gameId, kind: DayEffectKind.PROSTITUTE_ALIBI, consumedAt: null },
      select: { playerId: true },
    });
    this.logger.info({ gameId, activeEffectCount: effects.length }, '[DayEffectRepository.listActiveProstituteAlibiPlayerIds] Active day effects loaded');
    return effects.map((effect) => effect.playerId);
  }

  public async clearUnconsumedProstituteAlibis(gameId: string): Promise<number> {
    this.logger.debug({ gameId }, '[DayEffectRepository.clearUnconsumedProstituteAlibis] Clearing expired day effects');
    const update = await this.prisma.dayEffect.updateMany({
      where: {
        gameId,
        kind: DayEffectKind.PROSTITUTE_ALIBI,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    this.logger.info({ gameId, clearedEffectCount: update.count }, '[DayEffectRepository.clearUnconsumedProstituteAlibis] Expired day effects cleared');
    return update.count;
  }
}
