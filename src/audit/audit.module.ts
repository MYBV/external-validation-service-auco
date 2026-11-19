import { Module } from '@nestjs/common';
import { DynamoModule } from '../database/dynamo/dynamo.module.js';
import { MongoModule } from '../database/mongo/mongo.module.js';
import { OutboxRepository } from './repositories/outbox.repository.js';
import { ValidationAuditRepository } from './repositories/validation-audit.repository.js';
import { AuditPublisher } from './services/audit-publisher.service.js';
import { AuditRecoveryWorker } from './services/audit-recovery.worker.js';

/**
 * Audit outbox, DynamoDB audit trail, publisher and autonomous recovery
 * worker. Not global.
 */
@Module({
  imports: [MongoModule, DynamoModule],
  providers: [
    OutboxRepository,
    ValidationAuditRepository,
    AuditPublisher,
    AuditRecoveryWorker,
  ],
  exports: [OutboxRepository, AuditPublisher],
})
export class AuditModule {}
