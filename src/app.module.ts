import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { HealthController } from './health/health.controller.js';
import { ValidationsModule } from './validations/validations.module.js';

@Module({
  imports: [CommonModule, ValidationsModule],
  controllers: [HealthController],
})
export class AppModule {}
