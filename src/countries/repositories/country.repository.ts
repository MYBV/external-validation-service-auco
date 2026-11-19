import { Injectable } from '@nestjs/common';
import type { IndexDescription, WithId } from 'mongodb';
import { MongoRepository } from '../../database/mongo/mongo.repository.js';
import { MongoService } from '../../database/mongo/mongo.service.js';
import type {
  ICountry,
  ICountrySeed,
} from '../interfaces/country.interface.js';

export const COUNTRIES_COLLECTION = 'countries';

@Injectable()
export class CountryRepository extends MongoRepository<ICountry> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { code: 1 }, name: 'code_unique', unique: true },
  ];

  constructor(mongo: MongoService) {
    super(mongo, COUNTRIES_COLLECTION);
  }

  findByCode(code: string): Promise<WithId<ICountry> | null> {
    return this.findOne({ code });
  }

  /**
   * Inserts the countries that do not exist yet and leaves existing ones
   * untouched ($setOnInsert only). Returns how many were inserted.
   */
  async seed(countries: readonly ICountrySeed[]): Promise<number> {
    const now = new Date();
    let inserted = 0;
    for (const country of countries) {
      const result = await this.collection.updateOne(
        { code: country.code },
        {
          $setOnInsert: {
            code: country.code,
            name: country.name,
            enabled: country.enabled,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      inserted += result.upsertedCount;
    }
    return inserted;
  }
}
