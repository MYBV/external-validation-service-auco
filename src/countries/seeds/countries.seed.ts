import type { ICountrySeed } from '../interfaces/country.interface.js';

/**
 * Initial catalog. Only Colombia and Mexico: no other country is added
 * without an explicit decision.
 */
export const COUNTRIES_SEED: readonly ICountrySeed[] = [
  { code: 'CO', name: 'Colombia', enabled: true },
  { code: 'MX', name: 'Mexico', enabled: true },
];
