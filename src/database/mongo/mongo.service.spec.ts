import type { ClientSession } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import { MongoService } from './mongo.service.js';

const config = makeAppConfig({ MONGO_URI: 'mongodb://127.0.0.1:27018' });

function fakeSession() {
  return {
    withTransaction: vi.fn((work: () => Promise<unknown>) => work()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
}

describe('MongoService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires MONGO_URI', () => {
    expect(() => new MongoService(makeAppConfig())).toThrow(/MONGO_URI/);
  });

  it('connects and pings on init and closes on shutdown', async () => {
    const service = new MongoService(config);
    const connect = vi
      .spyOn(service.client, 'connect')
      .mockResolvedValue(service.client);
    const ping = vi.spyOn(service.db, 'command').mockResolvedValue({ ok: 1 });
    const close = vi.spyOn(service.client, 'close').mockResolvedValue();

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(connect).toHaveBeenCalledOnce();
    expect(ping).toHaveBeenCalledWith({ ping: 1 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not swallow connection failures', async () => {
    const service = new MongoService(config);
    const failure = new Error('cannot connect');
    vi.spyOn(service.client, 'connect').mockRejectedValue(failure);

    await expect(service.onModuleInit()).rejects.toBe(failure);
  });

  it('runs the work in a majority transaction and returns its result', async () => {
    const service = new MongoService(config);
    const session = fakeSession();
    vi.spyOn(service.client, 'startSession').mockReturnValue(
      session as unknown as ClientSession,
    );

    const result = await service.withTransaction(() => Promise.resolve(42));

    expect(result).toBe(42);
    expect(session.withTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'majority' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
    expect(session.endSession).toHaveBeenCalledOnce();
  });

  it('rethrows the original error and still ends the session', async () => {
    const service = new MongoService(config);
    const session = fakeSession();
    vi.spyOn(service.client, 'startSession').mockReturnValue(
      session as unknown as ClientSession,
    );
    const failure = new Error('boom');

    await expect(
      service.withTransaction(() => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(session.endSession).toHaveBeenCalledOnce();
  });
});
