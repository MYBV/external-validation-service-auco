import { readFileSync } from 'node:fs';
import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { ICountry } from '../interfaces/country.interface.js';
import type { CountryRepository } from '../repositories/country.repository.js';
import {
  CountriesService,
  UNSUPPORTED_COUNTRY_MESSAGE,
  UnsupportedCountryException,
} from './countries.service.js';

function entry(overrides: Partial<ICountry> = {}): ICountry {
  const now = new Date();
  return {
    code: 'CO',
    name: 'Colombia',
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CountriesService', () => {
  const findByCode = vi.fn();
  const seed = vi.fn();
  const service = new CountriesService({
    findByCode,
    seed,
  } as unknown as CountryRepository);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the enabled catalog entry', async () => {
    findByCode.mockResolvedValue(entry());

    await expect(service.assertEnabled('CO')).resolves.toMatchObject({
      code: 'CO',
    });
    expect(findByCode).toHaveBeenCalledWith('CO');
  });

  it('normalizes the code before querying', async () => {
    findByCode.mockResolvedValue(entry({ code: 'MX', name: 'Mexico' }));

    await service.assertEnabled(' mx ');

    expect(findByCode).toHaveBeenCalledWith('MX');
  });

  it.each(['', 'C', 'COL', '1X', 'C-'])(
    'rejects the malformed code %j without querying the catalog',
    async (code) => {
      await expect(service.assertEnabled(code)).rejects.toBeInstanceOf(
        ZodError,
      );
      expect(findByCode).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown and disabled countries with the same public error', async () => {
    findByCode.mockResolvedValueOnce(null);
    const unknown: unknown = await service
      .assertEnabled('ZZ')
      .catch((error: unknown) => error);

    findByCode.mockResolvedValueOnce(entry({ enabled: false }));
    const disabled: unknown = await service
      .assertEnabled('CO')
      .catch((error: unknown) => error);

    expect(unknown).toBeInstanceOf(UnsupportedCountryException);
    expect(disabled).toBeInstanceOf(UnsupportedCountryException);
    for (const error of [unknown, disabled]) {
      expect(error).toBeInstanceOf(BadRequestException);
      const exception = error as UnsupportedCountryException;
      expect(exception.getStatus()).toBe(400);
      expect(exception.getResponse()).toMatchObject({
        message: UNSUPPORTED_COUNTRY_MESSAGE,
      });
      expect(JSON.stringify(exception.getResponse())).not.toMatch(
        /NOT_FOUND|DISABLED/,
      );
    }
    expect((unknown as UnsupportedCountryException).reason).toBe('NOT_FOUND');
    expect((disabled as UnsupportedCountryException).reason).toBe('DISABLED');
  });

  it('does not wrap repository errors', async () => {
    const failure = new Error('db down');
    findByCode.mockRejectedValue(failure);

    await expect(service.assertEnabled('CO')).rejects.toBe(failure);
  });

  it('seeds only CO and MX, enabled', async () => {
    seed.mockResolvedValue(2);

    await expect(service.seed()).resolves.toBe(2);

    expect(seed).toHaveBeenCalledWith([
      { code: 'CO', name: 'Colombia', enabled: true },
      { code: 'MX', name: 'Mexico', enabled: true },
    ]);
  });

  it('does not depend on the request context', () => {
    const source = readFileSync(
      new URL('./countries.service.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/RequestContext|AsyncLocalStorage/);
  });
});
