# Pipeline HTTP: Seguridad, Validación, Respuestas y Errores

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Orden de ejecución](#orden-de-ejecución)
3. [Registro de los componentes globales](#registro-de-los-componentes-globales)
4. [ApiKeyGuard y @Public()](#apikeyguard-y-public)
5. [Validación con Zod](#validación-con-zod)
6. [ResponseInterceptor: respuestas exitosas](#responseinterceptor-respuestas-exitosas)
7. [TimeOutInterceptor](#timeoutinterceptor)
8. [AllExceptionFilter: contrato de error](#allexceptionfilter-contrato-de-error)
9. [configureApp() y Swagger](#configureapp-y-swagger)
10. [Consideraciones importantes](#consideraciones-importantes)
11. [Resumen](#resumen)

---

## Introducción

Todas las rutas pasan por el mismo pipeline, configurado en un único lugar (`CommonModule` y `configureApp()`), que reutilizan tanto el runtime como las pruebas e2e. El objetivo es que cualquier endpoint nuevo herede, sin código adicional:

- Autenticación por API key (salvo rutas marcadas `@Public()`).
- Respuestas exitosas con el envoltorio `{ data }`.
- Errores con un contrato único, sin stack traces, valores recibidos, credenciales ni datos personales.
- Un `x-request-id` para correlación (ver [`request-context.md`](./request-context.md)).
- Un límite de tiempo por request.

---

## Orden de ejecución

```
Request
  → body-parser (Express)
  → RequestContextMiddleware        crea el contexto ALS y x-request-id
  → ApiKeyGuard                     401 si falta o no coincide x-api-key
  → TimeOutInterceptor              arranca el límite REQUEST_TIMEOUT_MS
  → ResponseInterceptor
  → ZodValidationPipe               valida headers, body y params
  → Controller → Service
  ← ResponseInterceptor             envuelve el resultado en { data }
  ← TimeOutInterceptor              504 si el handler no emitió a tiempo
  → AllExceptionFilter              solo si algo lanzó una excepción
Response (siempre con x-request-id)
```

---

## Registro de los componentes globales

`CommonModule` es el **único** módulo `@Global()` (D-06). Registra los componentes transversales con los tokens de NestJS:

```typescript
@Global()
@Module({
  imports: [ConfigModule.forRoot(CONFIG_MODULE_OPTIONS)],
  providers: [
    { provide: APP_CONFIG, inject: [ConfigService], useFactory: /* buildAppConfig */ },
    RequestContextService,
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: TimeOutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionFilter },
  ],
  exports: [APP_CONFIG, RequestContextService],
})
export class CommonModule implements NestModule { /* middleware */ }
```

| Componente | Archivo |
| --- | --- |
| `ApiKeyGuard` | `src/common/guards/api-key.guard.ts` |
| `@Public()` | `src/common/decorators/public.decorator.ts` |
| `ZodValidationPipe` | `src/common/pipes/zod-validation.pipe.ts` |
| `@RequestHeaders()` | `src/common/decorators/request-headers.decorator.ts` |
| `ResponseInterceptor` | `src/common/interceptors/response.interceptor.ts` |
| `TimeOutInterceptor` | `src/common/interceptors/timeout.interceptor.ts` |
| `AllExceptionFilter` | `src/common/filters/all-exception.filter.ts` |
| Nombres de headers | `src/common/constants/headers.constants.ts` |

---

## ApiKeyGuard y @Public()

El guard es global: **toda ruta está protegida por defecto**. Lee el header `x-api-key` y lo compara con `API_KEY` (mínimo 32 caracteres, validada al arrancar).

```typescript
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

canActivate(context: ExecutionContext): boolean {
  const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
    IS_PUBLIC_KEY, [context.getHandler(), context.getClass()],
  );
  if (isPublic) return true;

  const provided = request.headers[API_KEY_HEADER];
  if (typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), this.expectedDigest)) {
    throw new UnauthorizedException('Missing or invalid API key');
  }
  return true;
}
```

- Compara los **digests SHA-256** con `timingSafeEqual`: ambos tienen la misma longitud, así que la comparación es de tiempo constante y no revela la longitud de la clave esperada.
- Falta de header o valor incorrecto devuelven el mismo `401` y el mismo mensaje.
- El valor de la clave nunca se registra.

Para exponer una ruta sin API key se marca con `@Public()` (a nivel de método o de controller). Hoy solo `GET /health` es público:

```typescript
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): IHealthStatus { return { status: 'ok' }; }
}
```

> Swagger **documenta** la seguridad (`@ApiSecurity('api-key')`), pero lo que **protege** es el guard. Una ruta sin `@Public()` está protegida aunque olvide el decorador de Swagger.

---

## Validación con Zod

La validación de entradas usa esquemas Zod y un pipe genérico, sin `class-validator`:

```typescript
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value); // lanza ZodError sin modificarlo
  }
}
```

Se aplica por parámetro. Para validar headers se usa `@RequestHeaders()`, que inyecta el objeto de headers completo (nombres en minúsculas):

```typescript
create(
  @RequestHeaders(new ZodValidationPipe(createValidationHeadersSchema))
  headers: CreateValidationHeaders,
  @Body(new ZodValidationPipe(createValidationSchema))
  body: CreateValidationBody,
) { /* ... */ }
```

El pipe también **transforma**: por ejemplo, `validationIdSchema` convierte el `:id` en un `ObjectId` y `countryCodeSchema` normaliza el país a mayúsculas. Los esquemas de cada endpoint viven en `src/<módulo>/schemas/`.

Un `ZodError` llega al filtro y se convierte en `400` con `message: 'Validation failed'` y `details` (ruta del campo y mensaje de la regla), **nunca** con los valores recibidos.

---

## ResponseInterceptor: respuestas exitosas

Envuelve cualquier resultado exitoso en `{ data }` (D-16), sin inspeccionarlo ni transformarlo:

```typescript
intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<IResponseEnvelope<T>> {
  return next.handle().pipe(map((data) => ({ data })));
}
```

- `null`, `false`, `0`, `''` y `[]` son datos válidos: se envuelven igual.
- No renombra campos: el mapeo de `_id` a `id` lo hace el mapper de cada módulo (`toValidationResponse`).
- No maneja errores: eso es tarea del filtro.

```json
{ "data": { "id": "6740f1c2a1b2c3d4e5f60718" } }
```

---

## TimeOutInterceptor

Convierte un handler que no emite dentro de `REQUEST_TIMEOUT_MS` (por defecto `15000`) en `504 Gateway Timeout` con el mensaje `Request timeout`. Los demás errores se propagan sin cambios.

> **Limitación importante:** es un timeout de RxJS. Responde al cliente, pero **no cancela** el trabajo en curso: una transacción de MongoDB o una escritura en DynamoDB pueden completarse después del `504`. Por eso cada dependencia tiene su propio timeout (`MONGO_TIMEOUT_MS`, `DYNAMODB_TIMEOUT_MS`, `HTTP_TIMEOUT_MS`) y la publicación inline de auditoría calcula su presupuesto según el tiempo restante del request (ver [`auditoria-outbox.md`](./auditoria-outbox.md#publicación-inline)). Con `Idempotency-Key`, repetir el `POST` tras un `504` es seguro.

---

## AllExceptionFilter: contrato de error

Todas las excepciones terminan en un cuerpo con la misma forma:

```typescript
export interface IErrorResponse {
  readonly statusCode: number;
  readonly error: string;      // texto estándar del código HTTP
  readonly message: string;
  readonly path: string;       // sin query string
  readonly timestamp: string;  // ISO 8601
  readonly requestId: string;
  readonly details?: readonly IErrorDetail[]; // solo en errores de Zod
}
```

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation failed",
  "path": "/validations",
  "timestamp": "2026-11-19T15:30:00.000Z",
  "requestId": "3f0c5c7e-1d2b-4a8e-9c3f-2b1d0e9a7c55",
  "details": [
    { "path": "x-country-code", "message": "Must be a two-letter ISO 3166-1 alpha-2 code" }
  ]
}
```

### Normalización por tipo de excepción

| Excepción | Código | `message` |
| --- | --- | --- |
| `ZodError` | `400` | `Validation failed` + `details` |
| `HttpException` (incluye las de NestJS) | El de la excepción | El mensaje de la excepción |
| Error de cliente de Express/body-parser (por ejemplo JSON mal formado) | Su `4xx` | Solo el texto estándar del código (su mensaje podría repetir contenido del request) |
| Cualquier otra cosa (errores del driver, del SDK, desconocidos) | `500` | `Internal server error` |

### Reglas de seguridad

- Nunca devuelve stack traces, mensajes internos, valores recibidos ni credenciales.
- Solo registra en log los errores `>= 500`, con método, ruta, código y **nombre de la clase** del error (nunca su mensaje).
- Si la respuesta ya empezó a enviarse (`headersSent`), no intenta escribir otra.
- Añade siempre el header `x-request-id`.

Las excepciones de dominio se lanzan como `HttpException` con mensajes fijos en inglés (por ejemplo `UnsupportedCountryException` extiende `BadRequestException`). Los errores de infraestructura que el servicio no sabe interpretar **se propagan sin envolver** y el filtro los convierte en `500`.

---

## configureApp() y Swagger

`src/app.setup.ts` concentra la configuración HTTP que no se puede declarar en módulos. `main.ts` y las pruebas e2e la llaman igual:

```typescript
export function configureApp(app: INestApplication): void {
  (app.getHttpAdapter().getInstance() as Express).disable('x-powered-by');
  app.enableShutdownHooks();

  const config = app.get<IAppConfig>(APP_CONFIG);
  if (config.swaggerEnabled) {
    setupSwagger(app);
  }
}
```

- Sin prefijo global ni versionado: las rutas son `/validations`, `/validations/:id` y `/health`.
- `X-Powered-By` deshabilitado.
- `enableShutdownHooks()` permite cerrar MongoDB, DynamoDB y el worker de auditoría al recibir `SIGTERM`/`SIGINT`.
- Swagger UI en `/docs` solo si `SWAGGER_ENABLED=true` (por defecto `false`). El esquema de seguridad se llama `api-key` (`addApiKey` sobre el header `x-api-key`). La metadata general está en `src/swagger-conf.ts` y la de cada módulo en `src/<módulo>/swagger/` (por ejemplo `SWCONF_VALIDATIONS`).

---

## Consideraciones importantes

1. **Rutas nuevas protegidas por defecto.** Solo `@Public()` las abre; revisar en las pruebas e2e que una ruta protegida responda `401` sin clave.
2. **No capturar errores para "convertirlos" en 500.** Dejar que el filtro lo haga; capturar solo lo que se sabe interpretar (ver la estrategia en `ValidationsService`).
3. **Mensajes de error fijos y en inglés.** Las respuestas de la API y Swagger van en inglés (convención del proyecto).
4. **No usar el timeout del request como garantía de cancelación.** Usar timeouts por dependencia.

---

## Resumen

- ✅ Guard global de API key con comparación en tiempo constante; `@Public()` como excepción explícita.
- ✅ Zod valida y transforma headers, body y params; los errores no repiten los valores recibidos.
- ✅ Éxitos envueltos en `{ data }`; errores con un contrato único y `requestId`.
- ✅ Timeout por request (`504`) que no cancela trabajo en curso.
- ✅ `configureApp()` compartido por runtime y pruebas; Swagger opcional en `/docs`.
