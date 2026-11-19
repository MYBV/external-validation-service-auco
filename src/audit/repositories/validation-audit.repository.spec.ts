import { ObjectId } from 'mongodb';
import { makeAppConfig } from '../../../test/support/app-config.js';
import { DynamoService } from '../../database/dynamo/dynamo.service.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';
import {
  buildAuditKeys,
  ValidationAuditRepository,
} from './validation-audit.repository.js';

function event(overrides: Partial<IOutboxEvent> = {}): IOutboxEvent {
  return {
    eventId: '6f1c2b8e-0000-4000-8000-000000000001',
    validationId: new ObjectId('64b7f0c2a1b2c3d4e5f60718'),
    eventType: 'VALIDATION_CREATED',
    documentNumber: '1020304050',
    countryCode: 'CO',
    occurredAt: new Date('2026-03-01T10:20:30.123Z'),
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: new Date('2026-03-01T10:20:30.123Z'),
    ...overrides,
  };
}

describe('ValidationAuditRepository', () => {
  it('builds country-scoped keys: PK by country and document, SK by time and event id', () => {
    const item = ValidationAuditRepository.buildItem(event());

    expect(item.PK).toBe('DOCUMENT#CO#1020304050');
    expect(item.SK).toBe(
      '2026-03-01T10:20:30.123Z#6f1c2b8e-0000-4000-8000-000000000001',
    );
  });

  it('does not mix the same number of different countries', () => {
    const co = ValidationAuditRepository.buildItem(event());
    const mx = ValidationAuditRepository.buildItem(
      event({ countryCode: 'MX' }),
    );
    expect(co.PK).not.toBe(mx.PK);
  });

  it('is deterministic and keeps the document number out of the attributes', () => {
    const first = ValidationAuditRepository.buildItem(event());
    const second = ValidationAuditRepository.buildItem(event());

    expect(second).toEqual(first);
    expect(first).toEqual({
      PK: 'DOCUMENT#CO#1020304050',
      SK: '2026-03-01T10:20:30.123Z#6f1c2b8e-0000-4000-8000-000000000001',
      eventId: '6f1c2b8e-0000-4000-8000-000000000001',
      validationId: '64b7f0c2a1b2c3d4e5f60718',
      eventType: 'VALIDATION_CREATED',
      countryCode: 'CO',
      createdAt: '2026-03-01T10:20:30.123Z',
      schemaVersion: 1,
    });
    expect(JSON.stringify({ ...first, PK: '', SK: '' })).not.toContain(
      '1020304050',
    );
  });

  it('orders sort keys chronologically and breaks same-millisecond ties by event id', () => {
    const at = (iso: string, id: string) =>
      buildAuditKeys('CO', '1', new Date(iso), id).sk;
    const sks = [
      at('2026-03-01T10:20:30.200Z', 'a'),
      at('2026-03-01T10:20:30.100Z', 'b'),
      at('2026-02-28T23:59:59.999Z', 'c'),
      at('2026-03-01T10:20:30.100Z', 'a'),
    ];
    expect([...sks].sort()).toEqual([sks[2], sks[3], sks[1], sks[0]]);
  });

  it('recognises the same event and rejects any identity difference', () => {
    const item = ValidationAuditRepository.buildItem(event());
    expect(ValidationAuditRepository.isSameEvent({ ...item }, item)).toBe(true);
    for (const change of [
      { eventId: 'other' },
      { validationId: '64b7f0c2a1b2c3d4e5f60719' },
      { countryCode: 'MX' },
      { createdAt: '2026-03-01T10:20:30.124Z' },
      { schemaVersion: 2 },
    ]) {
      expect(
        ValidationAuditRepository.isSameEvent({ ...item, ...change }, item),
      ).toBe(false);
    }
  });

  it('reads the history of one document through its partition key', async () => {
    const dynamo = new DynamoService(
      makeAppConfig({
        DYNAMODB_ENDPOINT: 'http://127.0.0.1:8001',
        AWS_ACCESS_KEY_ID: 'local',
        AWS_SECRET_ACCESS_KEY: 'local',
      }),
    );
    const repository = new ValidationAuditRepository(dynamo);
    const query = vi
      .spyOn(repository, 'queryByPartition')
      .mockResolvedValue([]);

    await repository.listByDocument('CO', '1020304050', 10);

    expect(query).toHaveBeenCalledWith('DOCUMENT#CO#1020304050', { limit: 10 });
  });
});
