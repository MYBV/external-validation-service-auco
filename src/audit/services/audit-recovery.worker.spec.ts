import { Logger } from '@nestjs/common';
import { makeAppConfig } from '../../../test/support/app-config.js';
import type {
  AuditPublisher,
  IBatchResult,
} from './audit-publisher.service.js';
import { AuditRecoveryWorker } from './audit-recovery.worker.js';

const EMPTY: IBatchResult = {
  claimed: 0,
  published: 0,
  retried: 0,
  failed: 0,
  stale: 0,
  unsettled: 0,
};

function setup(env: Record<string, string> = {}) {
  const publisher = {
    processPendingBatch: vi.fn().mockResolvedValue(EMPTY),
  };
  const worker = new AuditRecoveryWorker(
    publisher as unknown as AuditPublisher,
    makeAppConfig({
      AUDIT_WORKER_INTERVAL_MS: '1000',
      AUDIT_BATCH_SIZE: '7',
      ...env,
    }),
  );
  return { worker, publisher };
}

describe('AuditRecoveryWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does nothing when disabled', async () => {
    const { worker, publisher } = setup({ AUDIT_WORKER_ENABLED: 'false' });

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5000);

    expect(publisher.processPendingBatch).not.toHaveBeenCalled();
    await worker.onApplicationShutdown();
  });

  it('runs a cycle at startup and then at every interval, with the batch size', async () => {
    const { worker, publisher } = setup();

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(1);
    expect(publisher.processPendingBatch.mock.calls[0]?.[0]).toBe(7);

    await vi.advanceTimersByTimeAsync(1000);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(4);

    await worker.onApplicationShutdown();
  });

  it('does not block bootstrap while the first cycle is hanging', () => {
    const { worker, publisher } = setup();
    publisher.processPendingBatch.mockReturnValue(new Promise(() => undefined));

    expect(() => worker.onApplicationBootstrap()).not.toThrow();
  });

  it('never overlaps cycles', async () => {
    const { worker, publisher } = setup();
    let release: (result: IBatchResult) => void = () => undefined;
    publisher.processPendingBatch.mockReturnValue(
      new Promise<IBatchResult>((resolve) => {
        release = resolve;
      }),
    );

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(3500);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(1);

    release(EMPTY);
    publisher.processPendingBatch.mockResolvedValue(EMPTY);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(2);

    await worker.onApplicationShutdown();
  });

  it('reports a stalled cycle once, without starting a concurrent cycle or abandoning it', async () => {
    const { worker, publisher } = setup({ AUDIT_LEASE_MS: '20000' });
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    publisher.processPendingBatch.mockReturnValue(new Promise(() => undefined));

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(39000);
    expect(error).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(error).toHaveBeenCalledTimes(1);
    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(1);

    const shutdown = worker.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(5000);
    await shutdown;
  });

  it('recovers from a stall report once the cycle finally ends', async () => {
    const { worker, publisher } = setup({
      AUDIT_LEASE_MS: '2000',
      AUDIT_INLINE_TIMEOUT_MS: '100',
      DYNAMODB_TIMEOUT_MS: '100',
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let release: (result: IBatchResult) => void = () => undefined;
    publisher.processPendingBatch.mockReturnValueOnce(
      new Promise<IBatchResult>((resolve) => {
        release = resolve;
      }),
    );
    publisher.processPendingBatch.mockResolvedValue(EMPTY);

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(6000);
    release(EMPTY);
    await vi.advanceTimersByTimeAsync(1000);

    expect(publisher.processPendingBatch.mock.calls.length).toBeGreaterThan(1);
    await worker.onApplicationShutdown();
  });

  it('survives a failing cycle and keeps running', async () => {
    const { worker, publisher } = setup();
    publisher.processPendingBatch
      .mockRejectedValueOnce(new Error('mongo down'))
      .mockResolvedValue(EMPTY);

    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(1000);

    expect(publisher.processPendingBatch).toHaveBeenCalledTimes(2);
    await worker.onApplicationShutdown();
  });

  it('stops the timer on shutdown and waits for the running cycle', async () => {
    const { worker, publisher } = setup();
    let release: (result: IBatchResult) => void = () => undefined;
    publisher.processPendingBatch.mockReturnValue(
      new Promise<IBatchResult>((resolve) => {
        release = resolve;
      }),
    );
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const shutdown = worker.onApplicationShutdown().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    release(EMPTY);
    await shutdown;
    expect(stopped).toBe(true);

    publisher.processPendingBatch.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(publisher.processPendingBatch).not.toHaveBeenCalled();
  });

  it('gives up waiting for a stuck cycle after a bounded time', async () => {
    const { worker, publisher } = setup();
    publisher.processPendingBatch.mockReturnValue(new Promise(() => undefined));
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);

    const shutdown = worker.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(shutdown).resolves.toBeUndefined();
  });

  it('tells the batch to stop once shutting down', async () => {
    const { worker, publisher } = setup();
    let shouldStop: () => boolean = () => false;
    publisher.processPendingBatch.mockImplementation(
      (_limit: number, options: { shouldStop: () => boolean }) => {
        shouldStop = options.shouldStop;
        return new Promise(() => undefined);
      },
    );
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(shouldStop()).toBe(false);

    void worker.onApplicationShutdown();

    expect(shouldStop()).toBe(true);
  });
});
