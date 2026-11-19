import { Module } from '@nestjs/common';
import { DynamoService } from './dynamo.service.js';

/** DynamoDB infrastructure. Not global: domain modules import it explicitly. */
@Module({
  providers: [DynamoService],
  exports: [DynamoService],
})
export class DynamoModule {}
