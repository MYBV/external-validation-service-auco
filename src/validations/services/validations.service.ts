import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ObjectId, type WithId } from 'mongodb';
import { OutboxRepository } from '../../audit/repositories/outbox.repository.js';
import type { IOutboxEvent } from '../../audit/interfaces/outbox-event.interface.js';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { CountriesService } from '../../countries/services/countries.service.js';
import {
  isDuplicateKeyOnIndex,
  isTransientMongoError,
  isUnknownCommitResult,
} from '../../database/mongo/mongo-errors.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import { RestCountriesService } from '../../enrichment/services/rest-countries.service.js';
import {
  type IIdempotencyConfig,
  requireIdempotencyConfig,
} from '../idempotency-config.js';
import type {
  ICreatedValidation,
  ICreateValidationInput,
  IValidation,
  IValidationResponse,
} from '../interfaces/validation.interface.js';
import { toValidationResponse } from '../mappers/validation.mapper.js';
import {
  IDEMPOTENCY_KEY_INDEX,
  ValidationRepository,
} from '../repositories/validation.repository.js';
import { computeRequestFingerprint } from '../utils/request-fingerprint.util.js';

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  'Idempotency key reuse with different content';
export const OUTCOME_UNCONFIRMED_MESSAGE =
  'Unable to confirm the operation; retry with the same Idempotency-Key';
export const OUTCOME_UNCONFIRMED_NO_KEY_MESSAGE =
  'Unable to confirm the operation';
export const VALIDATION_NOT_FOUND_MESSAGE = 'Validation not found';

/** Persistence attempts per request when an Idempotency-Key is present. */
export const MAX_PERSISTENCE_ATTEMPTS = 3;
/** Reads of the winning record after a collision: 3 reads, 2 short waits. */
const WINNER_READ_ATTEMPTS = 3;
const WINNER_READ_DELAYS_MS: readonly number[] = [25, 50];

interface IPendingWrite {
  readonly validationId: ObjectId;
  readonly validation: IValidation;
  readonly event: IOutboxEvent;
}

/**
 * Orchestrates the validation use cases. REST Countries is called once and
 * never inside the MongoDB transaction; ids and timestamps are generated once
 * before any persistence attempt, so every attempt writes identical documents.
 * Errors are mapped to HTTP only where the outcome is known; unknown database
 * errors propagate untouched.
 */
@Injectable()
export class ValidationsService {
  private readonly idempotency: IIdempotencyConfig;

  constructor(
    private readonly mongo: MongoService,
    private readonly validations: ValidationRepository,
    private readonly outbox: OutboxRepository,
    private readonly countries: CountriesService,
    private readonly restCountries: RestCountriesService,
    @Inject(APP_CONFIG) appConfig: IAppConfig,
  ) {
    this.idempotency = requireIdempotencyConfig(appConfig);
  }

  async create(input: ICreateValidationInput): Promise<ICreatedValidation> {
    const { idempotencyKey } = input;
    const fingerprint =
      idempotencyKey === undefined
        ? undefined
        : computeRequestFingerprint(this.idempotency.hashSecret, input);

    if (idempotencyKey !== undefined && fingerprint !== undefined) {
      const existing =
        await this.validations.findByIdempotencyKey(idempotencyKey);
      if (existing !== null) {
        return this.resolveExisting(existing, fingerprint);
      }
    }

    const country = await this.countries.assertEnabled(input.countryCode);
    const enrichment = await this.restCountries.enrich(country.code);

    const now = new Date();
    const validationId = new ObjectId();
    const pending: IPendingWrite = {
      validationId,
      validation: {
        name: input.name,
        documentNumber: input.documentNumber,
        countryCode: country.code,
        enrichment,
        createdAt: now,
        ...(idempotencyKey === undefined || fingerprint === undefined
          ? {}
          : { idempotencyKey, requestFingerprint: fingerprint }),
      },
      event: {
        eventId: randomUUID(),
        validationId,
        eventType: 'VALIDATION_CREATED',
        documentNumber: input.documentNumber,
        countryCode: country.code,
        occurredAt: now,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
      },
    };

    if (idempotencyKey === undefined || fingerprint === undefined) {
      return this.persistOnce(pending);
    }
    return this.persistIdempotently(pending, idempotencyKey, fingerprint);
  }

  async findById(id: ObjectId): Promise<IValidationResponse> {
    const validation = await this.validations.findById(id);
    if (validation === null) {
      throw new NotFoundException(VALIDATION_NOT_FOUND_MESSAGE);
    }
    return toValidationResponse(validation);
  }

  /** Validation and outbox event in one transaction; the same session for both. */
  private store(pending: IPendingWrite): Promise<void> {
    return this.mongo.withTransaction(async (session) => {
      await this.validations.create(
        { _id: pending.validationId, ...pending.validation },
        session,
      );
      await this.outbox.create({ ...pending.event }, session);
    });
  }

  /**
   * Single attempt for requests without an Idempotency-Key. Errors propagate
   * untouched, except an unknown commit result (for example maxCommitTimeMS
   * expiring), which does not prove a rollback: the record is looked up by its
   * own id. Found means the commit landed; otherwise the outcome is unknown
   * and a retry without a key could create a second record.
   */
  private async persistOnce(
    pending: IPendingWrite,
  ): Promise<ICreatedValidation> {
    const id = pending.validationId.toHexString();
    try {
      await this.store(pending);
      return { id };
    } catch (error: unknown) {
      if (!isUnknownCommitResult(error)) {
        throw error;
      }
      const landed = await this.validations.findById(pending.validationId);
      if (landed !== null) {
        return { id };
      }
      throw new ServiceUnavailableException(OUTCOME_UNCONFIRMED_NO_KEY_MESSAGE);
    }
  }

  /**
   * Bounded persistence for requests with an Idempotency-Key. Only three
   * outcomes are interpreted: a collision on the idempotency index, a
   * transient transaction error that survived the driver's own retries, and
   * an unknown commit result. Anything else is rethrown untouched.
   */
  private async persistIdempotently(
    pending: IPendingWrite,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<ICreatedValidation> {
    const id = pending.validationId.toHexString();
    for (let attempt = 1; attempt <= MAX_PERSISTENCE_ATTEMPTS; attempt++) {
      try {
        await this.store(pending);
        return { id };
      } catch (error: unknown) {
        if (isUnknownCommitResult(error)) {
          // The commit may have been applied: look for our own record.
          const landed = await this.validations.findById(pending.validationId);
          if (landed !== null && landed.requestFingerprint === fingerprint) {
            return { id };
          }
        }
        const collision = isDuplicateKeyOnIndex(
          error,
          IDEMPOTENCY_KEY_INDEX,
          'idempotencyKey',
        );
        if (!collision && !isTransientMongoError(error)) {
          throw error;
        }
        const winner = await this.findWinner(idempotencyKey);
        if (winner !== null) {
          return this.resolveExisting(winner, fingerprint);
        }
        // Winner not visible: retry the same documents while attempts remain.
      }
    }
    throw new ServiceUnavailableException(OUTCOME_UNCONFIRMED_MESSAGE);
  }

  private async findWinner(
    idempotencyKey: string,
  ): Promise<WithId<IValidation> | null> {
    for (let read = 1; read <= WINNER_READ_ATTEMPTS; read++) {
      const winner =
        await this.validations.findByIdempotencyKey(idempotencyKey);
      if (winner !== null) {
        return winner;
      }
      const delay = WINNER_READ_DELAYS_MS[read - 1];
      if (delay !== undefined) {
        await sleep(delay);
      }
    }
    return null;
  }

  private resolveExisting(
    existing: WithId<IValidation>,
    fingerprint: string,
  ): ICreatedValidation {
    if (existing.requestFingerprint !== fingerprint) {
      throw new ConflictException(IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return { id: existing._id.toHexString() };
  }
}
