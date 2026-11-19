import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and transforms a body, parameter or header with a Zod schema.
 * A failure throws the ZodError untouched; AllExceptionFilter turns it into a
 * 400 listing paths and rule messages, never the received values.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value);
  }
}
