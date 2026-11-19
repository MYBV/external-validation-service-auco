
---
paths:
  - "src/database/**"
  - "src/**/repositories/**"
  - "src/audit/**"
---

# Database Rules

- Use the official MongoDB Node.js driver.
- Never introduce Mongoose.
- Use minimal generic base repositories.
- Keep MongoDB and DynamoDB repositories independent.
- Do not add unused CRUD operations.
- Never call process.exit() from repositories.
- Never swallow persistence errors.
- Preserve duplicate key and conditional write errors.
- Use MongoDB transactions for validation and outbox creation.
- Use stable event identifiers for audit idempotency.
- Use AWS SDK v3 and DynamoDBDocumentClient.
- Do not log documents containing personal data.
- Avoid soft delete and pagination unless explicitly required.
