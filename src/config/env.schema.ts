import { z } from 'zod';

const requiredString = (minLength = 1) => z.string().trim().min(minLength);

const positiveInt = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

/** Accepts only the literal strings 'true' and 'false'. */
const strictBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const optionalString = () =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .optional();

const optionalHttpUrl = () =>
  optionalString().refine(
    (value) => {
      if (value === undefined) {
        return true;
      }
      try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be an http or https URL' },
  );

/**
 * Cross-cutting variables are required here. The persistence variables are
 * optional at this level so the HTTP foundation does not depend on any
 * database; the MongoDB and DynamoDB modules require the ones they need when
 * they are instantiated (see src/database/mongo and src/database/dynamo).
 * Variables for later stages (REST Countries, audit) are added by the stage
 * that needs them.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: positiveInt(3000).pipe(z.number().max(65535)),
  API_KEY: requiredString(32),
  SWAGGER_ENABLED: strictBoolean(false),
  REQUEST_TIMEOUT_MS: positiveInt(15000),
  MONGO_URI: optionalString(),
  MONGO_DB_NAME: requiredString().default('external_validation'),
  MONGO_TIMEOUT_MS: positiveInt(5000),
  DYNAMODB_ENDPOINT: optionalHttpUrl(),
  DYNAMODB_TABLE: requiredString().default('validation_audit'),
  DYNAMODB_TIMEOUT_MS: positiveInt(2000),
  AWS_REGION: requiredString().default('us-east-1'),
  AWS_ACCESS_KEY_ID: optionalString(),
  AWS_SECRET_ACCESS_KEY: optionalString(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables. Failures list the offending variable
 * names and rule messages only, never the received values (they may be secrets).
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`,
  );
  throw new Error(
    `Invalid environment configuration:\n- ${problems.join('\n- ')}`,
  );
}
