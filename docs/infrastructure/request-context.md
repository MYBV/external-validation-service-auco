# AsyncLocalStorage: Contexto por Request

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Componentes](#componentes)
3. [Datos almacenados en el contexto](#datos-almacenados-en-el-contexto)
4. [Flujo de un request](#flujo-de-un-request)
5. [Inicialización: RequestContextMiddleware](#inicialización-requestcontextmiddleware)
6. [Lectura del contexto](#lectura-del-contexto)
7. [Quién usa el contexto hoy](#quién-usa-el-contexto-hoy)
8. [Consideraciones importantes](#consideraciones-importantes)
9. [Testing](#testing)
10. [Resumen](#resumen)

---

## Introducción

El servicio usa **`AsyncLocalStorage`** de Node.js para mantener un contexto aislado por cada request HTTP. El contexto guarda datos de **correlación y tiempo** (`requestId`, ruta, hora de inicio) que están disponibles en cualquier punto de la cadena asíncrona del request, sin pasarlos como parámetros.

A diferencia de otros servicios donde el guard escribe usuario, organización o idioma en el contexto, aquí el contexto:

- Se crea **una sola vez** en el middleware y es **inmutable** (todos sus campos son `readonly`; no hay setters).
- **No contiene datos personales** ni secretos: nunca guarda `name`, `documentNumber`, la API key ni el body.
- **No es fuente de verdad de negocio**: el código de país que guarda es solo para correlación (ver [Datos almacenados](#datos-almacenados-en-el-contexto)).

---

## Componentes

| Componente | Archivo | Responsabilidad |
| --- | --- | --- |
| `requestContextStorage` | `src/common/context/request-context.storage.ts` | **Única** instancia de `AsyncLocalStorage<IRequestContext>` de la aplicación (D-15). |
| `RequestContextService` | `src/common/services/request-context.service.ts` | Envoltura inyectable: `run(context, callback)` y `get()`. |
| `RequestContextMiddleware` | `src/common/middlewares/request-context.middleware.ts` | Crea el contexto al inicio de cada request y responde el header `x-request-id`. |
| `@CurrentContext()` | `src/common/decorators/current-context.decorator.ts` | Decorador de parámetro para leer el contexto en controllers. |
| `IRequestContext` | `src/common/interfaces/request-context.interface.ts` | Forma del contexto. |
| `getRequestPath()` | `src/common/utils/request-path.util.ts` | Elimina el query string de la URL (puede llevar valores sensibles). |

`RequestContextService` y `@CurrentContext()` leen **la misma** instancia de `AsyncLocalStorage`. No se debe crear otra: dos almacenes distintos producirían contextos que no se ven entre sí.

```typescript
// src/common/context/request-context.storage.ts
export const requestContextStorage = new AsyncLocalStorage<IRequestContext>();

// src/common/services/request-context.service.ts
@Injectable()
export class RequestContextService {
  run<T>(context: IRequestContext, callback: () => T): T {
    return requestContextStorage.run(context, callback);
  }

  get(): IRequestContext | undefined {
    return requestContextStorage.getStore();
  }
}
```

`RequestContextService` lo provee y exporta `CommonModule`, el único módulo global, por lo que cualquier servicio puede inyectarlo.

---

## Datos almacenados en el contexto

```typescript
export interface IRequestContext {
  readonly requestId: string;
  /** URL path only: the query string is never stored. */
  readonly requestUrl: string;
  readonly startedAt: Date;
  /** Correlation data only: NOT validated against the countries catalog. */
  readonly countryCode?: string;
}
```

| Campo | Tipo | Origen | Uso |
| --- | --- | --- | --- |
| `requestId` | `string` (UUID v4) | Generado con `randomUUID()` | Correlación en logs, header `x-request-id` y cuerpo de error |
| `requestUrl` | `string` | `req.originalUrl` sin query string | Trazabilidad; `path` de los errores |
| `startedAt` | `Date` | Hora en que entra el request al middleware | Presupuesto de tiempo de la publicación inline de auditoría |
| `countryCode` | `string` \| `undefined` | Header `x-country-code` en mayúsculas, **solo** si cumple `^[A-Za-z]{2}$` | Solo correlación. `undefined` en `GET` o si el header no tiene ese formato |

> **Importante (D-14):** `countryCode` del contexto **no** está validado contra el catálogo `countries`. La lógica de negocio usa siempre el valor validado por Zod y confirmado por `CountriesService.assertEnabled()`. Ver [`catalogo-paises.md`](./catalogo-paises.md).

---

## Flujo de un request

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Request HTTP entrante                                         │
│    (Express ya ejecutó body-parser: un JSON mal formado falla    │
│     aquí, ANTES del middleware, y no tendrá contexto)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. RequestContextMiddleware  ← AQUÍ SE CREA EL CONTEXTO          │
│    - requestId = randomUUID()                                    │
│    - requestUrl = path sin query string                          │
│    - startedAt = new Date()                                      │
│    - countryCode = x-country-code en mayúsculas si es ^[A-Za-z]{2}$ │
│    - res.setHeader('x-request-id', requestId)                    │
│    - requestContext.run(context, () => next())                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ApiKeyGuard (global)                                          │
│    - No escribe en el contexto                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. TimeOutInterceptor → ResponseInterceptor                      │
│ 5. ZodValidationPipe (headers, body, params)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Controller → Service                                          │
│    - RestCountriesService: requestId en logs de fallo            │
│    - ValidationsService: startedAt para la auditoría inline      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. AllExceptionFilter (solo en error)                            │
│    - requestId del contexto (o uno nuevo si no hay contexto)     │
│    - Lo devuelve en el cuerpo y en el header x-request-id        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. Response HTTP (siempre con x-request-id)                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Inicialización: RequestContextMiddleware

```typescript
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawCountryCode = req.headers[COUNTRY_CODE_HEADER];
    const countryCode =
      typeof rawCountryCode === 'string' && TWO_LETTER_CODE.test(rawCountryCode)
        ? rawCountryCode.toUpperCase()
        : undefined;

    const context: IRequestContext = {
      requestId: randomUUID(),
      requestUrl: getRequestPath(req.originalUrl),
      startedAt: new Date(),
      countryCode,
    };

    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    this.requestContext.run(context, () => next());
  }
}
```

Se registra en `CommonModule` (no en `AppModule`), para **todas** las rutas y métodos:

```typescript
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
```

> **¿Por qué middleware y no interceptor?** En NestJS los middlewares se ejecutan antes que guards, interceptors y pipes. Crear el contexto aquí garantiza que exista durante todo el ciclo, incluido el filtro de excepciones cuando falla el guard o la validación.

El `requestId` lo genera siempre el servidor: el servicio **no** acepta un `x-request-id` enviado por el cliente.

---

## Lectura del contexto

### En controllers: `@CurrentContext()`

```typescript
import { CurrentContext } from '../../common/decorators/current-context.decorator.js';
import type { IRequestContext } from '../../common/interfaces/request-context.interface.js';

@Get(':id')
findById(
  @Param('id', new ZodValidationPipe(validationIdSchema)) id: ObjectId,
  @CurrentContext() context: IRequestContext | undefined,
) {
  // context?.requestId, context?.startedAt ...
}
```

Hoy ningún controller lo usa: los controllers son delgados y delegan en servicios. El decorador existe para los casos en que el controller lo necesite.

### En servicios: inyectar `RequestContextService`

```typescript
@Injectable()
export class RestCountriesService {
  constructor(private readonly requestContext: RequestContextService /* ... */) {}

  private logFailure(reason: string, startedAt: number): void {
    const requestId = this.requestContext.get()?.requestId ?? 'n/a';
    this.logger.warn(`[${requestId}] REST Countries lookup failed (${reason}) ...`);
  }
}
```

`get()` devuelve `undefined` fuera de un request, por eso todos los consumidores usan `?.` y un valor por defecto.

---

## Quién usa el contexto hoy

| Consumidor | Campo | Para qué |
| --- | --- | --- |
| `AllExceptionFilter` | `requestId` | Campo `requestId` del cuerpo de error y header `x-request-id`. Si no hay contexto (por ejemplo, JSON mal formado rechazado por body-parser), genera un UUID nuevo. |
| `RestCountriesService` | `requestId` | Prefijo de los logs de fallo del proveedor (sin URL, headers ni body). |
| `ValidationsService` → `AuditPublisher.publishInline()` | `startedAt` | Calcular cuánto tiempo le queda al request para el intento inline de auditoría. Ver [`auditoria-outbox.md`](./auditoria-outbox.md#publicación-inline). |
| `AuditRecoveryWorker` | — | **No** usa el contexto: corre en su propio temporizador, fuera de cualquier request. |

---

## Consideraciones importantes

### 1. El contexto solo existe dentro del ciclo del request

```typescript
// ✅ Dentro del request
const id = this.requestContext.get()?.requestId;

// ❌ En un temporizador o en el worker de auditoría
setInterval(() => {
  this.requestContext.get(); // undefined
}, 15000);
```

Por eso `AuditPublisher.inlineBudgetMs()` usa el máximo configurado cuando `startedAt` es `undefined`.

### 2. Nunca guardar datos personales

El contexto se usa en logs. Agregar `name`, `documentNumber`, la API key o el body rompería la regla de minimización de datos (requisito §7 de [`development-stages/01-requirements.md`](../development-stages/01-requirements.md)).

### 3. Sin query string

`requestUrl` y el `path` de los errores pasan por `getRequestPath()`: un query string podría llevar valores sensibles.

### 4. Singleton y una sola instancia de ALS

`RequestContextService` no tiene scope de request: es un singleton. El aislamiento lo da `AsyncLocalStorage`, no la instancia del servicio.

---

## Testing

Para ejecutar código dentro de un contexto en una prueba unitaria:

```typescript
const context: IRequestContext = {
  requestId: 'test-request',
  requestUrl: '/validations',
  startedAt: new Date(),
  countryCode: 'CO',
};

new RequestContextService().run(context, () => {
  expect(new RequestContextService().get()).toBe(context);
});
```

En los servicios con dobles basta un objeto `{ get: vi.fn().mockReturnValue(undefined) }` (ver `validations.service.spec.ts`). Las pruebas e2e verifican además el aislamiento entre requests concurrentes y la presencia de `x-request-id` (`test/http-foundation.e2e-spec.ts`).

---

## Resumen

- ✅ Una sola instancia de `AsyncLocalStorage`, compartida por `RequestContextService` y `@CurrentContext()`.
- ✅ El contexto se crea en `RequestContextMiddleware`, antes de guards, interceptors y pipes, y es inmutable.
- ✅ Contiene `requestId`, `requestUrl` (sin query string), `startedAt` y un `countryCode` solo de correlación.
- ✅ Todas las respuestas llevan `x-request-id`; los errores también lo incluyen en el cuerpo.
- ✅ Sin datos personales ni secretos.
- ⚠️ Fuera de un request (worker, temporizadores) el contexto es `undefined`.
