import { z } from 'zod';

/** ISO 3166-1 alpha-2 code: trimmed, uppercased, exactly two letters. */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Must be a two-letter ISO 3166-1 alpha-2 code');
