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

/**
 * Only variables required by the cross-cutting infrastructure are validated.
 * Variables for later stages (MongoDB, DynamoDB, REST Countries, audit) are
 * added to this schema by the stage that needs them.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: positiveInt(3000).pipe(z.number().max(65535)),
  API_KEY: requiredString(32),
  SWAGGER_ENABLED: strictBoolean(false),
  REQUEST_TIMEOUT_MS: positiveInt(15000),
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
