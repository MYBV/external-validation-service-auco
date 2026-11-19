export interface IRequestContext {
  readonly requestId: string;
  /** URL path only: the query string is never stored. */
  readonly requestUrl: string;
  readonly startedAt: Date;
  /**
   * Correlation data only: uppercased x-country-code when it has a two-letter
   * format. It is NOT validated against the countries catalog and business
   * logic must never use it.
   */
  readonly countryCode?: string;
}
