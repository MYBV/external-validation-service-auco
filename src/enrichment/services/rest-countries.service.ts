import {
  BadGatewayException,
  GatewayTimeoutException,
  type HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG, type IAppConfig } from '../../config/configuration.js';
import { countryCodeSchema } from '../../countries/schemas/country-code.schema.js';
import { RequestContextService } from '../../common/services/request-context.service.js';
import {
  type IRestCountriesConfig,
  requireRestCountriesConfig,
} from '../enrichment-config.js';
import type { ICountryEnrichment } from '../interfaces/country-enrichment.interface.js';
import {
  type RestCountry,
  restCountriesResponseSchema,
} from '../schemas/rest-countries.schema.js';

export const ENRICHMENT_UNAVAILABLE_MESSAGE =
  'Geographic enrichment unavailable';

const RESPONSE_FIELDS = [
  'names.common',
  'names.official',
  'codes.alpha_2',
  'region',
  'subregion',
  'capitals',
  'languages',
  'currencies',
].join(',');

const TIMEOUT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
]);

/**
 * Geographic enrichment through REST Countries v5. The only datum sent to the
 * provider is the ISO country code (the single parameter of `enrich`); the
 * provider key travels only in the Authorization header. Provider failures
 * are translated to fixed, generic HTTP exceptions: neither the provider's
 * body or messages nor the key are ever exposed or logged. There are no
 * automatic retries.
 */
@Injectable()
export class RestCountriesService {
  private readonly logger = new Logger(RestCountriesService.name);
  private readonly config: IRestCountriesConfig;

  constructor(
    private readonly http: HttpService,
    private readonly requestContext: RequestContextService,
    @Inject(APP_CONFIG) appConfig: IAppConfig,
  ) {
    this.config = requireRestCountriesConfig(appConfig);
  }

  async enrich(countryCode: string): Promise<ICountryEnrichment> {
    const code = countryCodeSchema.parse(countryCode);
    const startedAt = Date.now();

    let body: unknown;
    try {
      const response = await firstValueFrom(
        this.http.get<unknown>(
          `${this.config.baseUrl}/codes.alpha_2/${encodeURIComponent(code)}`,
          {
            params: { response_fields: RESPONSE_FIELDS },
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
          },
        ),
      );
      body = response.data;
    } catch (error: unknown) {
      throw this.translateRequestError(error, startedAt);
    }

    const parsed = restCountriesResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw this.unavailable('invalid response schema', startedAt);
    }
    const { objects } = parsed.data.data;
    if (objects.length === 0) {
      throw this.unavailable('empty result', startedAt);
    }
    const country = objects.find(
      (candidate) => candidate.codes.alpha_2.toUpperCase() === code,
    );
    if (country === undefined) {
      throw this.unavailable('country code mismatch', startedAt);
    }
    return this.toEnrichment(code, country);
  }

  private toEnrichment(code: string, country: RestCountry): ICountryEnrichment {
    return {
      source: 'rest-countries',
      code,
      commonName: country.names.common,
      ...(country.names.official && { officialName: country.names.official }),
      ...(country.region && { region: country.region }),
      ...(country.subregion && { subregion: country.subregion }),
      capitals: (country.capitals ?? []).map((capital) => capital.name),
      languages: (country.languages ?? []).map((language) => language.name),
      currencies: (country.currencies ?? []).map((currency) => ({
        code: currency.code,
        name: currency.name,
        ...(currency.symbol && { symbol: currency.symbol }),
      })),
      enrichedAt: new Date(),
    };
  }

  private translateRequestError(
    error: unknown,
    startedAt: number,
  ): HttpException {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (error.code !== undefined && TIMEOUT_ERROR_CODES.has(error.code)) {
        this.logFailure(`timeout`, startedAt);
        return new GatewayTimeoutException(ENRICHMENT_UNAVAILABLE_MESSAGE);
      }
      if (status === 429) {
        this.logFailure('status 429', startedAt);
        return new ServiceUnavailableException(ENRICHMENT_UNAVAILABLE_MESSAGE);
      }
      return this.unavailable(
        status === undefined ? 'network error' : `status ${status}`,
        startedAt,
      );
    }
    return this.unavailable(
      `unexpected ${error instanceof Error ? error.name : typeof error}`,
      startedAt,
    );
  }

  private unavailable(reason: string, startedAt: number): BadGatewayException {
    this.logFailure(reason, startedAt);
    return new BadGatewayException(ENRICHMENT_UNAVAILABLE_MESSAGE);
  }

  /** Bounded metadata only: no URL, headers, body or provider messages. */
  private logFailure(reason: string, startedAt: number): void {
    const requestId = this.requestContext.get()?.requestId ?? 'n/a';
    this.logger.warn(
      `[${requestId}] REST Countries lookup failed (${reason}) after ${Date.now() - startedAt}ms`,
    );
  }
}
