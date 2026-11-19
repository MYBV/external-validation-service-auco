import { Injectable } from '@nestjs/common';
import type { IndexDescription, WithId } from 'mongodb';
import { MongoRepository } from '../../database/mongo/mongo.repository.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import type { IValidation } from '../interfaces/validation.interface.js';

export const VALIDATIONS_COLLECTION = 'validations';
export const IDEMPOTENCY_KEY_INDEX = 'idempotencyKey_unique';

@Injectable()
export class ValidationRepository extends MongoRepository<IValidation> {
  /**
   * Partial unique index: only documents that carry an idempotency key are
   * indexed, so any number of validations may be created without one. This
   * index, not the previous lookup, is what arbitrates concurrent requests.
   */
  protected override readonly indexes: readonly IndexDescription[] = [
    {
      key: { idempotencyKey: 1 },
      name: IDEMPOTENCY_KEY_INDEX,
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    },
  ];

  constructor(mongo: MongoService) {
    super(mongo, VALIDATIONS_COLLECTION);
  }

  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WithId<IValidation> | null> {
    return this.findOne({ idempotencyKey });
  }
}
