import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { SWCONF_HEALTH } from './swagger/health.swagger.js';

export interface IHealthStatus {
  readonly status: 'ok';
}

@ApiTags(SWCONF_HEALTH.tag)
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation(SWCONF_HEALTH.operation)
  @ApiOkResponse(SWCONF_HEALTH.okResponse)
  check(): IHealthStatus {
    return { status: 'ok' };
  }
}
