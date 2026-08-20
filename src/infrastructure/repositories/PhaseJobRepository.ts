import type { PhaseJob, PrismaClient } from '@prisma/client';

import type { AppLogger } from '../../observability/logger.js';

export class PhaseJobRepository {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: AppLogger,
  ) {}

  public async listDueJobs(now: Date): Promise<PhaseJob[]> {
    this.logger.debug({ now }, '[PhaseJobRepository.listDueJobs] Loading due phase jobs');
    return this.prisma.phaseJob.findMany({
      where: { dueAt: { lte: now }, processedAt: null },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });
  }

  public async claimJob(jobId: string, now: Date): Promise<boolean> {
    const update = await this.prisma.phaseJob.updateMany({
      where: { id: jobId, processedAt: null, dueAt: { lte: now } },
      data: { processedAt: now },
    });

    if (update.count !== 1) {
      this.logger.warn({ jobId }, '[PhaseJobRepository.claimJob] Job was already claimed or is not due');
      return false;
    }

    this.logger.debug({ jobId }, '[PhaseJobRepository.claimJob] Claimed phase job');
    return true;
  }

  public async releaseJob(jobId: string): Promise<void> {
    const update = await this.prisma.phaseJob.updateMany({
      where: { id: jobId, processedAt: { not: null } },
      data: { processedAt: null },
    });
    this.logger.warn({ jobId, released: update.count === 1 }, '[PhaseJobRepository.releaseJob] Released failed phase job for retry');
  }
}
