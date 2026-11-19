import {
  buildAppConfig,
  type IAppConfig,
} from '../../src/config/configuration.js';
import { validateEnv } from '../../src/config/env.schema.js';

/** Builds a validated IAppConfig from a minimal environment plus overrides. */
export function makeAppConfig(env: Record<string, string> = {}): IAppConfig {
  return buildAppConfig(validateEnv({ API_KEY: 'k'.repeat(32), ...env }));
}
