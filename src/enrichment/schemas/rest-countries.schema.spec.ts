import { restCountriesResponseSchema } from './rest-countries.schema.js';

function fixture(code: string, name: string) {
  return {
    data: {
      objects: [
        {
          codes: { alpha_2: code, alpha_3: 'XXX' },
          names: { common: name, official: `Official ${name}`, native: {} },
          region: 'Americas',
          subregion: 'South America',
          capitals: [{ name: 'Capital', coordinates: { lat: 1, lng: 2 } }],
          languages: [{ name: 'Spanish', iso639_3: 'spa' }],
          currencies: [{ code: 'XXX', name: 'Currency', symbol: '$' }],
          leaders: [{ name: 'must be stripped' }],
        },
      ],
      meta: { total: 1, request_id: 'abc' },
    },
  };
}

describe('restCountriesResponseSchema', () => {
  it.each([
    ['CO', 'Colombia'],
    ['MX', 'Mexico'],
  ])('accepts a v5 response for %s and strips unknown fields', (code, name) => {
    const parsed = restCountriesResponseSchema.parse(fixture(code, name));

    const [country] = parsed.data.objects;
    expect(country?.codes).toEqual({ alpha_2: code });
    expect(country?.names.common).toBe(name);
    expect(country).not.toHaveProperty('leaders');
    expect(parsed.data).not.toHaveProperty('meta');
  });

  it('accepts a country with only the mandatory fields', () => {
    const parsed = restCountriesResponseSchema.safeParse({
      data: {
        objects: [{ codes: { alpha_2: 'CO' }, names: { common: 'Colombia' } }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty objects array (the caller decides what it means)', () => {
    expect(
      restCountriesResponseSchema.safeParse({ data: { objects: [] } }).success,
    ).toBe(true);
  });

  it.each([
    ['null body', null],
    ['no data envelope', { objects: [] }],
    ['objects is not an array', { data: { objects: {} } }],
    [
      'missing alpha_2',
      { data: { objects: [{ codes: {}, names: { common: 'X' } }] } },
    ],
    [
      'missing common name',
      { data: { objects: [{ codes: { alpha_2: 'CO' }, names: {} }] } },
    ],
    [
      'wrong type in capitals',
      {
        data: {
          objects: [
            {
              codes: { alpha_2: 'CO' },
              names: { common: 'Colombia' },
              capitals: ['Bogota'],
            },
          ],
        },
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(restCountriesResponseSchema.safeParse(body).success).toBe(false);
  });
});
