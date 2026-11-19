import { z } from 'zod';

const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]+$/u;

const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NO_CONTROL_CHARACTERS, 'Must not contain control characters');

/**
 * Body of POST /validations. Unknown fields are rejected. Values are only
 * trimmed: legitimate names and document formats are never altered, and
 * nothing is inferred from the document number.
 */
export const createValidationSchema = z.strictObject({
  name: boundedText(120),
  documentNumber: boundedText(64),
});

export type CreateValidationBody = z.infer<typeof createValidationSchema>;
