// Optional manual smoke test against the REAL REST Countries v5 API.
//
// - Not part of Vitest or any automated suite: it consumes provider quota.
// - Makes exactly ONE request (country CO) and never prints the credential.
// - Validates the body with the same Zod schema the service uses (from dist/).
// - Run it with: npm run smoke:rest-countries
//
// Exit codes: 0 verified, 1 provider/contract failure, 2 not executed
// (no legitimate key configured).
import process from 'node:process';
import { restCountriesResponseSchema } from '../dist/enrichment/schemas/rest-countries.schema.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment.
}

const DEFAULT_BASE_URL = 'https://api.restcountries.com/countries/v5';
const COUNTRY_CODE = 'CO';

const apiKey = (process.env.REST_COUNTRIES_API_KEY ?? '').trim();
const baseUrl = (process.env.REST_COUNTRIES_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS) || 5000;

if (apiKey === '' || apiKey.startsWith('replace-with') || apiKey === 'rc_live_demo') {
  console.log(
    'NOT EXECUTED: no legitimate REST_COUNTRIES_API_KEY is configured ' +
      '(empty, placeholder or demo key). The real integration remains unverified.',
  );
  process.exit(2);
}

const url = new URL(`${baseUrl}/codes.alpha_2/${COUNTRY_CODE}`);
url.searchParams.set('response_fields', 'names.common,codes.alpha_2,region');

const startedAt = Date.now();
try {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const elapsed = `${Date.now() - startedAt} ms`;
  if (!response.ok) {
    console.error(`FAILED: provider answered HTTP ${response.status} (${elapsed}).`);
    process.exit(1);
  }
  const parsed = restCountriesResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    console.error(`FAILED: response does not match the expected schema (${elapsed}).`);
    process.exit(1);
  }
  const country = parsed.data.data.objects.find(
    (candidate) => candidate.codes.alpha_2.toUpperCase() === COUNTRY_CODE,
  );
  if (country === undefined) {
    console.error(`FAILED: no object matches ${COUNTRY_CODE} (${elapsed}).`);
    process.exit(1);
  }
  console.log(
    `OK: HTTP ${response.status}, ${country.codes.alpha_2} = "${country.names.common}" (${elapsed}).`,
  );
} catch (error) {
  const reason = error instanceof Error ? error.name : 'unknown error';
  console.error(`FAILED: request did not complete (${reason}).`);
  process.exit(1);
}
