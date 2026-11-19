import { Injectable } from '@nestjs/common';
import type { IndexDescription } from 'mongodb';
import { MongoRepository } from '../../database/mongo/mongo.repository.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import type { IOutboxEvent } from '../interfaces/outbox-event.interface.js';

export const AUDIT_OUTBOX_COLLECTION = 'audit_outbox';
export const OUTBOX_EVENT_ID_INDEX = 'eventId_unique';
export const OUTBOX_STATUS_INDEX = 'status_nextAttemptAt';

/**
 * Minimal outbox persistence for Stage 4: events are only created (inside the
 * validation transaction). Publishing and recovery belong to Stage 5.
 */
@Injectable()
export class OutboxRepository extends MongoRepository<IOutboxEvent> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { eventId: 1 }, name: OUTBOX_EVENT_ID_INDEX, unique: true },
    { key: { status: 1, nextAttemptAt: 1 }, name: OUTBOX_STATUS_INDEX },
  ];

  constructor(mongo: MongoService) {
    super(mongo, AUDIT_OUTBOX_COLLECTION);
  }
}
