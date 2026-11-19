import { BadRequestException, Injectable } from '@nestjs/common';
import { CountryRepository } from '../repositories/country.repository.js';
import { COUNTRIES_SEED } from '../seeds/countries.seed.js';
import { countryCodeSchema } from '../schemas/country-code.schema.js';
import type { ICountry } from '../interfaces/country.interface.js';

export const UNSUPPORTED_COUNTRY_MESSAGE = 'Unsupported country code';

export type UnsupportedCountryReason = 'NOT_FOUND' | 'DISABLED';

/**
 * Same public message for unknown and disabled countries so the catalog is
 * not disclosed; `reason` stays internal (it is not part of the response).
 */
export class UnsupportedCountryException extends BadRequestException {
  constructor(readonly reason: UnsupportedCountryReason) {
    super(UNSUPPORTED_COUNTRY_MESSAGE);
  }
}

/**
 * Validates countries against the local catalog. It deliberately knows
 * nothing about the request context: callers pass the code received in the
 * header, and only the value returned here is trusted.
 */
@Injectable()
export class CountriesService {
  constructor(private readonly countries: CountryRepository) {}

  /**
   * Returns the enabled catalog entry for `code`. A malformed code raises a
   * ZodError (mapped to 400 by the global filter); an unknown or disabled
   * one raises UnsupportedCountryException (400).
   */
  async assertEnabled(code: string): Promise<ICountry> {
    const normalized = countryCodeSchema.parse(code);
    const country = await this.countries.findByCode(normalized);
    if (country === null) {
      throw new UnsupportedCountryException('NOT_FOUND');
    }
    if (!country.enabled) {
      throw new UnsupportedCountryException('DISABLED');
    }
    return country;
  }

  /** Idempotent: inserts only the missing countries and returns that count. */
  seed(): Promise<number> {
    return this.countries.seed(COUNTRIES_SEED);
  }
}
