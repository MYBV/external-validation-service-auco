---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "test/**"
  - "tests/**"
  - "vitest.config*.ts"
  - "vite.config.ts"
---

# Testing Rules

## Framework

- Use Vitest.
- Use @nestjs/testing for NestJS testing modules.
- Use Supertest for HTTP E2E tests.
- Do not introduce Jest.

## Testing Strategy

- Test observable behavior rather than implementation details.
- Keep tests deterministic.
- Mock external services for unit tests.
- Avoid real network calls in unit tests.
- Use isolated test data.
- Reset mocks and test state between tests.

## Required Scenarios

Cover at least:

- Successful validation creation.
- Invalid request payload.
- Missing or invalid API key.
- Invalid or unsupported country code.
- External API failure or timeout.
- Successful validation retrieval.
- Validation not found.
- Audit event creation.
- DynamoDB write failure.
- Duplicate audit event prevention.
- HTTP request idempotency.

## Integration Tests

- Test MongoDB transactions against a replica set.
- Test DynamoDB conditional writes against DynamoDB Local.
- Verify validation and outbox atomicity.
- Verify audit recovery after a failed publication.
- Verify no duplicate audit events after retries.

## HTTP Tests

- Reuse configureApp() to match production behavior.
- Verify HTTP status codes and response contracts.
- Verify authentication and request validation.
- Verify error responses do not leak sensitive data.

## Quality Requirements

- Do not weaken assertions to make tests pass.
- Do not delete failing tests without justification.
- Do not claim tests passed unless executed.
- Report any tests that could not be executed.
