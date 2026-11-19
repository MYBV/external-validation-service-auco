/** Entry of the `countries` catalog. `code` is ISO 3166-1 alpha-2, uppercase. */
export interface ICountry {
  code: string;
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields supplied by a seed; timestamps are set when the document is inserted. */
export type ICountrySeed = Pick<ICountry, 'code' | 'name' | 'enabled'>;
