/**
 * Small geographic snapshot of a country. It is NOT identity verification and
 * says nothing about the person: it only describes the selected country.
 */
export interface ICountryEnrichment {
  source: 'rest-countries';
  code: string;
  commonName: string;
  officialName?: string;
  region?: string;
  subregion?: string;
  capitals: string[];
  languages: string[];
  currencies: ICountryCurrency[];
  enrichedAt: Date;
}

export interface ICountryCurrency {
  code: string;
  name: string;
  symbol?: string;
}
