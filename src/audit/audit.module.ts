import { Module } from '@nestjs/common';
import { MongoModule } from '../database/mongo/mongo.module.js';
import { OutboxRepository } from './repositories/outbox.repository.js';

/** Audit outbox persistence. Not global; publishing arrives in Stage 5. */
@Module({
  imports: [MongoModule],
  providers: [OutboxRepository],
  exports: [OutboxRepository],
})
export class AuditModule {}
