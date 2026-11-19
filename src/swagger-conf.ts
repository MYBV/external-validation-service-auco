import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_HEADER } from './common/constants/headers.constants.js';

export const SWAGGER_TITLE = 'External Validation Service';
export const SWAGGER_DESCRIPTION =
  'Validation records enriched with public geographic data. Enrichment is not identity verification.';
export const SWAGGER_VERSION = '1.0';
export const SWAGGER_PATH = 'docs';
/** Name used by addApiKey() and @ApiSecurity(). */
export const API_KEY_SECURITY_NAME = 'api-key';

/**
 * Swagger only documents the API; the global ApiKeyGuard is what protects it.
 */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(SWAGGER_TITLE)
      .setDescription(SWAGGER_DESCRIPTION)
      .setVersion(SWAGGER_VERSION)
      .addApiKey(
        { type: 'apiKey', name: API_KEY_HEADER, in: 'header' },
        API_KEY_SECURITY_NAME,
      )
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
