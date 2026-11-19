import type { IAppConfig, IAuditSettings } from '../config/configuration.js';

/** Inline budget must leave room inside the lease of an orphaned operation. */
const MIN_LEASE_TO_INLINE_RATIO = 10;
/**
 * Worst case of one publication in DYNAMODB_TIMEOUT_MS units: every SDK call
 * can wait the connection timeout and then the request timeout (2), in up to
 * 2 attempts (x2), and an attempt is a put followed by a verification get
 * (x2). Retry delays and MongoDB calls come on top, which the default lease
 * covers with a wide margin.
 */
const WORST_CASE_DYNAMO_TIMEOUTS = 8;

/**
 * Returns the audit settings, failing with a readable error when they are
 * inconsistent:
 * - the inline publication budget must be shorter than the request timeout.
 *   This is a sanity check only: the real protection against a late 504 is
 *   the per-request budget computed by AuditPublisher.inlineBudgetMs;
 * - the lease must cover an inline operation that outlives its budget and the
 *   worst-case DynamoDB publication time (see WORST_CASE_DYNAMO_TIMEOUTS).
 */
export function requireAuditConfig(config: IAppConfig): IAuditSettings {
  const audit = config.audit;
  if (audit.inlineTimeoutMs >= config.requestTimeoutMs) {
    throw new Error(
      'AUDIT_INLINE_TIMEOUT_MS must be lower than REQUEST_TIMEOUT_MS',
    );
  }
  if (audit.leaseMs < audit.inlineTimeoutMs * MIN_LEASE_TO_INLINE_RATIO) {
    throw new Error(
      `AUDIT_LEASE_MS must be at least ${MIN_LEASE_TO_INLINE_RATIO} times AUDIT_INLINE_TIMEOUT_MS`,
    );
  }
  const worstCasePublicationMs =
    config.dynamo.timeoutMs * WORST_CASE_DYNAMO_TIMEOUTS;
  if (audit.leaseMs <= worstCasePublicationMs) {
    throw new Error(
      `AUDIT_LEASE_MS must exceed the worst-case DynamoDB publication time (${WORST_CASE_DYNAMO_TIMEOUTS} x DYNAMODB_TIMEOUT_MS)`,
    );
  }
  return audit;
}
