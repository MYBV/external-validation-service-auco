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
import { AuditPublisher } from '../../audit/services/audit-publisher.service.js';
import type { IOutboxEvent } from '../../audit/interfaces/outbox-event.interface.js';
import { RequestContextService } from '../../common/services/request-context.service.js';
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

/** Name and key of MongoDB's built-in primary key index. */
const PRIMARY_KEY_INDEX = '_id_';
const PRIMARY_KEY_FIELD = '_id';

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
    private readonly auditPublisher: AuditPublisher,
    private readonly requestContext: RequestContextService,
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
    } catch (error: unknown) {
      if (!isUnknownCommitResult(error)) {
        throw error;
      }
      const landed = await this.validations.findById(pending.validationId);
      if (landed === null) {
        throw new ServiceUnavailableException(
          OUTCOME_UNCONFIRMED_NO_KEY_MESSAGE,
        );
      }
    }
    // Committed (directly or proven by the lookup): the creation succeeded.
    await this.publishAuditBestEffort(pending.event.eventId);
    return { id };
  }

  /**
   * Bounded persistence for requests with an Idempotency-Key. Only four
   * outcomes are interpreted: a collision on the idempotency index, a
   * transient transaction error that survived the driver's own retries, an
   * unknown commit result, and a duplicate of our own `_id`. Anything else is
   * rethrown untouched.
   *
   * The `_id` duplicate happens when an earlier attempt ended with an unknown
   * commit result that was not yet visible, and that commit landed before this
   * retry: the retry then collides with its own record. `_id` is generated
   * once per request, so the record is looked up by it and accepted only when
   * it carries this request's fingerprint; otherwise the error is rethrown.
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
        await this.publishAuditBestEffort(pending.event.eventId);
        return { id };
      } catch (error: unknown) {
        if (
          isUnknownCommitResult(error) ||
          isDuplicateKeyOnIndex(error, PRIMARY_KEY_INDEX, PRIMARY_KEY_FIELD)
        ) {
          // The commit (of this or of an earlier attempt) may have been
          // applied: look for our own record.
          const landed = await this.validations.findById(pending.validationId);
          if (landed !== null && landed.requestFingerprint === fingerprint) {
            await this.publishAuditBestEffort(pending.event.eventId);
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
          const result = this.resolveExisting(winner, fingerprint);
          if (winner._id.equals(pending.validationId)) {
            // The winner is our own earlier attempt: a confirmed creation,
            // not a replay, so its audit event is published inline too.
            await this.publishAuditBestEffort(pending.event.eventId);
          }
          return result;
        }
        // Winner not visible: retry the same documents while attempts remain.
      }
    }
    throw new ServiceUnavailableException(OUTCOME_UNCONFIRMED_MESSAGE);
  }

  /**
   * Inline audit publication after a confirmed commit. It runs outside the
   * transaction, is bounded by AUDIT_INLINE_TIMEOUT_MS and by the time left
   * in the HTTP request (it is skipped when none is left) and can never change
   * the outcome of the creation: any failure (rejection or synchronous throw)
   * is swallowed here and the worker recovers the event later.
   */
  private async publishAuditBestEffort(eventId: string): Promise<void> {
    try {
      await this.auditPublisher.publishInline(
        eventId,
        this.requestContext.get()?.startedAt,
      );
    } catch {
      // Intentionally ignored: the outbox keeps the event PENDING.
    }
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
