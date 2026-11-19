import { ObjectId } from 'mongodb';
import { z } from 'zod';

/** Path parameter of GET /validations/:id: a 24-character hexadecimal ObjectId. */
export const validationIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a 24-character hexadecimal id')
  .transform((value) => new ObjectId(value));
