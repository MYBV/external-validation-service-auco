import { z } from 'zod';

/**
 * Shape of the REST Countries v5 response that this service relies on
 * (GET /countries/v5/codes.alpha_2/{code}). Unknown fields are stripped, so
 * the rest of the payload is never kept. Optional fields tolerate absence or
 * null; `codes.alpha_2` and `names.common` are mandatory. `data.meta` and the
 * demo notice are deliberately not part of the schema.
 */
const optionalText = z.string().nullish();

const restCountrySchema = z.object({
  codes: z.object({ alpha_2: z.string().min(1) }),
  names: z.object({
    common: z.string().min(1),
    official: optionalText,
  }),
  region: optionalText,
  subregion: optionalText,
  capitals: z.array(z.object({ name: z.string().min(1) })).nullish(),
  languages: z.array(z.object({ name: z.string().min(1) })).nullish(),
  currencies: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        symbol: optionalText,
      }),
    )
    .nullish(),
});

export const restCountriesResponseSchema = z.object({
  data: z.object({ objects: z.array(restCountrySchema) }),
});

export type RestCountry = z.infer<typeof restCountrySchema>;
export type RestCountriesResponse = z.infer<typeof restCountriesResponseSchema>;
