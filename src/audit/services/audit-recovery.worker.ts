import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { requireAuditConfig } from '../audit-config.js';
import { AuditPublisher } from './audit-publisher.service.js';

/** Longest wait for the running cycle when the application shuts down. */
const SHUTDOWN_WAIT_MS = 5000;
/**
 * A cycle running longer than this many leases is reported as stalled. It is
 * only reported: the cycle is never abandoned, because dropping the reference
 * of a pending promise would allow concurrent cycles and orphaned work.
 */
const STALL_WARNING_LEASES = 2;

/**
 * Recovers pending audit events on its own timer, independent of HTTP traffic
 * and of the request context. It runs one cycle at startup (not awaited, so an
 * unavailable DynamoDB never blocks the API) and then at a fixed interval.
 * Cycles never overlap; whatever a stopped cycle leaves behind is recovered
 * through lease expiry.
 */
@Injectable()
export class AuditRecoveryWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AuditRecoveryWorker.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly stallWarningMs: number;
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private cycleStartedAt = 0;
  private stallReported = false;
  private stopping = false;

  constructor(
    private readonly publisher: AuditPublisher,
    @Inject(APP_CONFIG) appConfig: IAppConfig,
  ) {
    const settings = requireAuditConfig(appConfig);
    this.enabled = settings.workerEnabled;
    this.intervalMs = settings.workerIntervalMs;
    this.batchSize = settings.batchSize;
    this.stallWarningMs = settings.leaseMs * STALL_WARNING_LEASES;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      return;
    }
    void this.runCycle();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.intervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = undefined;
    const running = this.current;
    if (running !== undefined) {
      let timer: NodeJS.Timeout | undefined;
      const limit = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
      });
      try {
        await Promise.race([running, limit]);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /** One recovery cycle. Resolves when it ends; skipped while another runs. */
  runCycle(): Promise<void> {
    if (this.current !== undefined) {
      this.reportStall();
      return this.current;
    }
    if (this.stopping) {
      return Promise.resolve();
    }
    this.cycleStartedAt = Date.now();
    this.stallReported = false;
    const cycle = this.publisher
      .processPendingBatch(this.batchSize, {
        shouldStop: () => this.stopping,
      })
      .then((result) => {
        if (result.claimed > 0) {
          this.logger.log(
            `Audit recovery cycle: claimed ${result.claimed}, published ${result.published}, retried ${result.retried}, failed ${result.failed}, stale ${result.stale}, unsettled ${result.unsettled}`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Audit recovery cycle failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      })
      .finally(() => {
        this.current = undefined;
      });
    this.current = cycle;
    return cycle;
  }

  /** Logs once per cycle that recovery is blocked behind a very long cycle. */
  private reportStall(): void {
    const runningMs = Date.now() - this.cycleStartedAt;
    if (!this.stallReported && runningMs > this.stallWarningMs) {
      this.stallReported = true;
      this.logger.error(
        `Audit recovery cycle has been running for ${Math.round(runningMs / 1000)} s; new cycles are skipped until it ends. Pending events stay safe in the outbox and are recovered after a restart`,
      );
    }
  }
}
