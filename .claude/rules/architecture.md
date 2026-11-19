---
paths:
  - "src/**/*.ts"
---

# Architecture Rules

## General Principles

- Use NestJS 12 with TypeScript and native ESM.
- Prefer simple, maintainable and testable solutions.
- Avoid speculative abstractions and unnecessary complexity.
- Follow dependency injection principles.
- Keep business logic independent from HTTP controllers.

## Module Organization

Use dedicated modules for:

- Validations
- Countries
- Enrichment
- Audit
- Database
- Common

Only CommonModule should be global.

DatabaseModule must manage database infrastructure.

Domain modules must not be global.

## Folder Conventions

Organize modules by responsibility when needed:

- controllers/
- services/
- repositories/
- entities/
- interfaces/
- schemas/
- messages/
- swagger/
- seeds/

Do not create empty or unnecessary folders.

## Services

- Use application services to orchestrate use cases.
- Keep persistence logic inside repositories.
- Keep external API integration in dedicated services.
- Introduce builders only for meaningful object construction.
- Introduce domain validators only when Zod is insufficient.
- Avoid services that merely forward calls without adding value.

## Configuration

- Use src/config/env.schema.ts for Zod environment validation.
- Use src/config/configuration.ts for typed application settings.
- Integrate configuration through NestJS ConfigModule.
- Do not rely on import side effects to load environment variables.
- Reject invalid configuration during application startup.

## Application Bootstrap

- Keep main.ts minimal.
- Use app.setup.ts for HTTP application configuration.
- Reuse configureApp() in application and E2E tests.
- Keep Swagger and global pipeline configuration centralized.

## Country Enrichment

- Maintain a MongoDB countries catalog.
- Use an idempotent country seed.
- Require x-country-code only for POST /validations.
- Do not require x-country-code for GET /validations/:id.
- Validate the country against the local catalog.
- Treat the request context countryCode as correlation data only;
  business logic uses the Zod-validated and catalog-checked value.
- Use REST Countries only for geographic enrichment.
- Never infer citizenship from document numbers.

## Identity Verification

- Geographic enrichment is not identity verification.
- Do not implement real identity verification in this challenge.
- Keep the design extensible for an independent
  IdentityVerificationService.
- Document future verification states separately.

## Scope Control

- Implement approved requirements incrementally.
- Do not introduce unrelated features.
- Explain significant architectural changes before implementation.
