import { Module } from '@nestjs/common';
import { MongoService } from './mongo.service.js';

/** MongoDB infrastructure. Not global: domain modules import it explicitly. */
@Module({
  providers: [MongoService],
  exports: [MongoService],
})
export class MongoModule {}
