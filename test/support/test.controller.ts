import {
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentContext } from '../../src/common/decorators/current-context.decorator.js';
import type { IRequestContext } from '../../src/common/interfaces/request-context.interface.js';
import { RequestContextService } from '../../src/common/services/request-context.service.js';

/**
 * Test-only controller (never part of the application). It exercises the
 * cross-cutting pipeline until real domain controllers exist.
 */
@Controller('__test')
export class TestController {
  constructor(private readonly requestContext: RequestContextService) {}

  /**
   * Reads the request context before and after an await, through both the
   * @CurrentContext() decorator and RequestContextService.
   */
  @Get('echo')
  async echo(
    @CurrentContext() before: IRequestContext | undefined,
    @Query('delay') delay: string | undefined,
  ) {
    await new Promise((resolve) => setTimeout(resolve, Number(delay ?? 0)));
    const after = this.requestContext.get();
    return {
      beforeRequestId: before?.requestId,
      afterRequestId: after?.requestId,
      requestUrl: after?.requestUrl,
    };
  }

  @Get('protected')
  protectedRoute(@CurrentContext() context: IRequestContext | undefined) {
    return { requestId: context?.requestId, countryCode: context?.countryCode };
  }

  @Get('null')
  nullRoute(): null {
    return null;
  }

  @Get('not-found')
  notFound(): never {
    throw new NotFoundException('Resource not found');
  }

  @Post('zod')
  zod(): never {
    z.object({ name: z.string().max(3), documentNumber: z.string() }).parse({
      name: 'SENSITIVE-PERSON-NAME',
      documentNumber: 123456789,
    });
    throw new Error('unreachable');
  }

  @Get('boom')
  boom(): never {
    throw new Error('mongodb://user:db-password@internal-host failed');
  }

  @Get('slow')
  async slow(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return 'late';
  }
}
