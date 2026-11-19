---
paths:
  - "**/*.ts"
  - "**/*.mts"
  - "tsconfig*.json"
---

# TypeScript Rules

## Language and Runtime

- Use TypeScript 6 with strict mode.
- Target Node.js 24.
- Use native ECMAScript modules.
- Follow the project's existing ESM configuration.
- Use .js extensions for relative imports when required.
- Prefer node: prefixes for Node.js built-in modules.

## Type Safety

- Never use explicit any.
- Never introduce implicit any.
- Use unknown for untrusted data.
- Narrow unknown values before accessing properties.
- Avoid unsafe type assertions.
- Avoid non-null assertions unless strictly justified.
- Use readonly where appropriate.
- Prefer explicit return types for public methods.

## Interfaces

- Prefix interface names with I.
- Examples:
  - IValidation
  - ICountry
  - IRequestContext
  - IValidationAuditEvent
- Use type for unions, aliases and Zod-inferred types.
- Do not create interfaces for primitive aliases.

## Validation

- Use Zod for runtime schemas.
- Infer TypeScript types from validated schemas where useful.
- Do not confuse TypeScript interfaces with runtime validation.
- Validate external API responses before mapping them.

## Code Style

- Follow Prettier configuration.
- Use single quotes.
- Use trailing commas.
- Use async/await for asynchronous operations.
- Prefer const over let.
- Avoid unnecessary utility wrappers.
- Use descriptive names.

## Error Handling

- Catch errors as unknown.
- Preserve relevant error information.
- Do not swallow errors silently.
- Do not expose sensitive internal details.

## Quality Gates

- Code must pass TypeScript type checking.
- Code must pass ESLint.
- Code must pass Prettier checks.
- Code must compile successfully.
