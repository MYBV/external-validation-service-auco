---
paths:
  - "src/**/*controller.ts"
  - "src/**/*guard.ts"
  - "src/**/*interceptor.ts"
  - "src/**/*filter.ts"
  - "src/**/*middleware.ts"
  - "src/**/*swagger.ts"
  - "src/common/decorators/**"
  - "src/enrichment/**"
  - "src/validations/**"
  - "src/audit/**"
  - "src/common/pipes/**"
  - "src/app.setup.ts"
  - "src/swagger-conf.ts"
---

# API Development Rules

## HTTP Contracts

- Keep controllers thin.
- Delegate business operations to application services.
- Preserve the required endpoints:
  - POST /validations
  - GET /validations/:id
- Provide GET /health as a public endpoint.
- Do not introduce unexpected URL prefixes.
- Use correct HTTP status codes.
- Document additional required headers explicitly.

## Validation

- Use Zod for runtime validation.
- Validate request bodies, parameters and headers.
- Validate external API responses before using them.
- Never trust external data based only on TypeScript types.

## Authentication

- Protect validation endpoints using an API key.
- Read the expected API key from validated configuration.
- Reject missing or invalid API keys with HTTP 401.
- Use a global guard and an explicit @Public() decorator.
- Keep the health endpoint public.
- Never log or expose API keys.

## Swagger

- Use @nestjs/swagger.
- Centralize Swagger metadata in constants.
- Keep module-specific Swagger definitions separate.
- Use addApiKey() and @ApiSecurity().
- Avoid excessive Swagger decorators in controllers.
- Keep Swagger documentation consistent with Zod schemas.

## Request Context

- Use AsyncLocalStorage for request context.
- Initialize context through middleware.
- Include requestId, requestUrl, startedAt and countryCode.
- Set countryCode only when the x-country-code header matches a two-letter
  format; store it uppercased, otherwise leave it undefined.
- The context countryCode is for correlation only. It is not validated
  against the countries catalog and must not drive business logic.
- Share a single AsyncLocalStorage instance between RequestContextService
  and @CurrentContext(). Never create independent instances.
- Return the request ID in response headers.
- Use @CurrentContext() only when explicitly needed.
- Do not introduce unrelated context properties.

## Interceptors

- Use a timeout interceptor.
- Use a minimal response interceptor that only wraps successful responses
  as { data }.
- Do not transform fields in the response interceptor; module mappers
  (for example, _id to id in validations) own field mapping.
- Do not introduce redundant request or global interceptors.
- Do not interpret null, false or zero as errors.
- Do not use response interceptors to handle exceptions.

## Exception Handling

- Use a global exception filter.
- Preserve expected NestJS HTTP exceptions.
- Distinguish validation, external API and database errors.
- Include requestId, timestamp and path in error responses.
- Never expose credentials, stack traces or personal data.
- Do not convert every exception into HTTP 500.

## External APIs

- Use NestJS HttpModule.
- Configure explicit HTTP timeouts.
- Keep external integrations isolated in dedicated services.
- Do not send personal information to REST Countries.
