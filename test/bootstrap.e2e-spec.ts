import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CONFIG_MODULE_OPTIONS } from '../src/config/configuration.js';
import { createTestApp } from './support/create-test-app.js';

describe('Bootstrap (e2e)', () => {
  describe('environment validation', () => {
    // Nest evaluates ConfigModule.forRoot() while the module graph is loaded.
    // The invalid configuration is exercised through CONFIG_MODULE_OPTIONS,
    // the exact options CommonModule uses, on an isolated testing module.
    const compileWithEnv = async (env: Record<string, string>) => {
      const previous = new Map<string, string | undefined>();
      for (const [key, value] of Object.entries(env)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
      }
      try {
        await Test.createTestingModule({
          imports: [ConfigModule.forRoot(CONFIG_MODULE_OPTIONS)],
        }).compile();
      } finally {
        // Restore variable by variable: process.env must stay Node's object.
        for (const [key, value] of previous) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    };

    it('rejects a missing or short API_KEY', async () => {
      await expect(compileWithEnv({ API_KEY: 'too-short' })).rejects.toThrow(
        /API_KEY/,
      );
    });

    it('rejects an invalid SWAGGER_ENABLED', async () => {
      await expect(
        compileWithEnv({ API_KEY: 'k'.repeat(32), SWAGGER_ENABLED: 'yes' }),
      ).rejects.toThrow(/SWAGGER_ENABLED/);
    });

    it('does not leak the rejected value in the startup error', async () => {
      const error = await compileWithEnv({ API_KEY: 'leaky-short-key' }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(String(error)).toContain('API_KEY');
      expect(String(error)).not.toContain('leaky-short-key');
    });
  });

  describe('Swagger', () => {
    it('is disabled by default', async () => {
      const app = await createTestApp({ SWAGGER_ENABLED: 'false' });
      try {
        await request(app.getHttpServer()).get('/docs-json').expect(404);
      } finally {
        await app.close();
      }
    });

    it('documents the API key scheme and public health when enabled', async () => {
      const app = await createTestApp({ SWAGGER_ENABLED: 'true' });
      try {
        // Swagger documentation itself is reachable without the API key.
        const response = await request(app.getHttpServer())
          .get('/docs-json')
          .expect(200);

        const document: unknown = response.body;
        expect(document).toMatchObject({
          components: {
            securitySchemes: {
              'api-key': { type: 'apiKey', name: 'x-api-key', in: 'header' },
            },
          },
          paths: { '/health': { get: {} } },
        });
        // Documenting is not protecting: the guard still rejects.
        await request(app.getHttpServer()).get('/__test/protected').expect(401);
      } finally {
        await app.close();
      }
    });
  });
});
