import { makeAppConfig } from '../../test/support/app-config.js';
import { requireAuditConfig } from './audit-config.js';

describe('requireAuditConfig', () => {
  it('accepts the defaults', () => {
    const config = makeAppConfig();
    expect(requireAuditConfig(config)).toEqual(config.audit);
  });

  it('rejects an inline budget not lower than the request timeout', () => {
    expect(() =>
      requireAuditConfig(
        makeAppConfig({
          REQUEST_TIMEOUT_MS: '1500',
          AUDIT_INLINE_TIMEOUT_MS: '1500',
        }),
      ),
    ).toThrow('AUDIT_INLINE_TIMEOUT_MS must be lower than REQUEST_TIMEOUT_MS');
  });

  it('rejects a lease shorter than ten inline budgets', () => {
    expect(() =>
      requireAuditConfig(
        makeAppConfig({
          AUDIT_LEASE_MS: '10000',
          AUDIT_INLINE_TIMEOUT_MS: '1500',
        }),
      ),
    ).toThrow('AUDIT_LEASE_MS must be at least 10 times');
  });

  it('rejects a lease that cannot cover a worst-case DynamoDB publication', () => {
    expect(() =>
      requireAuditConfig(
        makeAppConfig({
          AUDIT_LEASE_MS: '23000',
          AUDIT_INLINE_TIMEOUT_MS: '100',
          DYNAMODB_TIMEOUT_MS: '3000',
        }),
      ),
    ).toThrow('worst-case DynamoDB publication time (8 x');
    expect(() =>
      requireAuditConfig(
        makeAppConfig({
          AUDIT_LEASE_MS: '24001',
          AUDIT_INLINE_TIMEOUT_MS: '100',
          DYNAMODB_TIMEOUT_MS: '3000',
        }),
      ),
    ).not.toThrow();
  });
});
