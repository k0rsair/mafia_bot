import type { AppLogger } from '../observability/logger.js';
import type { PhaseJobRepository } from '../infrastructure/repositories/PhaseJobRepository.js';
import type { PhaseDeadlineResult, PhaseService } from './PhaseService.js';

export class PhaseClock {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly phaseJobRepository: PhaseJobRepository,
    private readonly phaseService: PhaseService,
    private readonly logger: AppLogger,
    private readonly onDeadline: (result: PhaseDeadlineResult) => Promise<void>,
    private readonly intervalMilliseconds: number = 5_000,
  ) {}

  public start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.logger.info({ intervalMilliseconds: this.intervalMilliseconds }, '[PhaseClock.start] Starting persistent phase clock');
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMilliseconds);
    void this.tick();
  }

  public stop(): void {
    if (this.timer === undefined) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.info('[PhaseClock.stop] Stopped persistent phase clock');
  }

  public async tick(): Promise<void> {
    const now = new Date();
    this.logger.debug({ now }, '[PhaseClock.tick] Checking due phase jobs');
    const dueJobs = await this.phaseJobRepository.listDueJobs(now);

    for (const job of dueJobs) {
      let claimed = false;
      let phaseProcessed = false;
      try {
        claimed = await this.phaseJobRepository.claimJob(job.id, now);
        if (!claimed) {
          continue;
        }

        const result = await this.phaseService.processExpiredJob(job);
        phaseProcessed = true;
        if (result !== null) {
          await this.onDeadline(result);
        }
      } catch (error) {
        this.logger.error({ jobId: job.id, gameId: job.gameId, error }, '[PhaseClock.tick] Failed to process phase job');
        if (claimed && !phaseProcessed) {
          await this.phaseJobRepository.releaseJob(job.id).catch((releaseError: unknown) => {
            this.logger.error({ jobId: job.id, gameId: job.gameId, releaseError }, '[PhaseClock.tick] Failed to release phase job after error');
          });
        }
      }
    }
  }
}
