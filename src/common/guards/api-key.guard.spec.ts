import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IAppConfig } from '../../config/configuration.js';
import { Public } from '../decorators/public.decorator.js';
import { ApiKeyGuard } from './api-key.guard.js';

const API_KEY = 'a'.repeat(32);
const config = { apiKey: API_KEY } as IAppConfig;

class ProtectedController {
  handler(): void {}
}

class PublicController {
  @Public()
  handler(): void {}
}

function contextFor(
  controller: typeof ProtectedController | typeof PublicController,
  headers: Record<string, unknown>,
): ExecutionContext {
  return {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only used as a metadata key
    getHandler: () => controller.prototype.handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const guard = new ApiKeyGuard(new Reflector(), config);

  it('allows a correct key', () => {
    expect(
      guard.canActivate(
        contextFor(ProtectedController, { 'x-api-key': API_KEY }),
      ),
    ).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'b'.repeat(32)],
    ['shorter', 'a'.repeat(10)],
    ['longer', 'a'.repeat(64)],
    ['empty', ''],
    ['repeated header', [API_KEY, API_KEY]],
  ])('rejects a %s key with 401', (_label, value) => {
    expect(() =>
      guard.canActivate(
        contextFor(ProtectedController, { 'x-api-key': value }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('does not reveal the expected key in the error', () => {
    try {
      guard.canActivate(contextFor(ProtectedController, {}));
      expect.unreachable('guard should have thrown');
    } catch (error) {
      expect(
        JSON.stringify((error as UnauthorizedException).getResponse()),
      ).not.toContain(API_KEY);
    }
  });

  it('allows @Public() routes without a key', () => {
    expect(guard.canActivate(contextFor(PublicController, {}))).toBe(true);
  });
});
