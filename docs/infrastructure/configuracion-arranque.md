# Configuración, Arranque e Inicialización de Infraestructura

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Grafo de módulos](#grafo-de-módulos)
3. [Configuración: esquema Zod y APP_CONFIG](#configuración-esquema-zod-y-app_config)
4. [Patrón "opcional en el esquema, exigida por el módulo"](#patrón-opcional-en-el-esquema-exigida-por-el-módulo)
5. [Variables de entorno](#variables-de-entorno)
6. [Secuencia de arranque](#secuencia-de-arranque)
7. [Apagado ordenado](#apagado-ordenado)
8. [Inicialización de infraestructura: `npm run infra:init`](#inicialización-de-infraestructura-npm-run-infrainit)
9. [Entorno local con Docker Compose](#entorno-local-con-docker-compose)
10. [Qué ocurre si algo falla al arrancar](#qué-ocurre-si-algo-falla-al-arrancar)

---

## Introducción

El servicio arranca con un `main.ts` mínimo y toda la configuración HTTP vive en `configureApp()` (ver [`pipeline-http.md`](./pipeline-http.md)). La configuración del entorno se valida **una vez**, al iniciar, con Zod; si algo es inválido el proceso no arranca y el error nombra la variable sin mostrar su valor.

```typescript
// src/main.ts
const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(app.get<IAppConfig>(APP_CONFIG).port);
```

La creación de índices, el seed de países y la tabla de DynamoDB **no** ocurren al arrancar la aplicación: son un paso explícito e idempotente, `npm run infra:init` (D-20).

---

## Grafo de módulos

```
AppModule
├── CommonModule  (@Global)   ConfigModule, APP_CONFIG, RequestContextService,
│                             ApiKeyGuard, interceptors, AllExceptionFilter, middleware
├── HealthController          GET /health (público)
└── ValidationsModule
    ├── MongoModule           MongoService
    ├── CountriesModule
    │   └── MongoModule
    ├── EnrichmentModule
    │   └── HttpModule        (@nestjs/axios, configurado con HTTP_TIMEOUT_MS)
    └── AuditModule
        ├── MongoModule
        └── DynamoModule      DynamoService
```

- **Solo `CommonModule` es global.** Los módulos de dominio y de infraestructura se importan de forma explícita donde se usan (D-17).
- `MongoModule` y `DynamoModule` son independientes; no existe un `DatabaseModule` agregador. Aunque varios módulos importan `MongoModule`, NestJS crea **una sola** instancia de `MongoService` (un único `MongoClient` por proceso).
- `HttpModule` solo se importa en `EnrichmentModule`; no hay un cliente HTTP genérico transversal.

---

## Configuración: esquema Zod y APP_CONFIG

| Archivo | Responsabilidad |
| --- | --- |
| `src/config/env.schema.ts` | `envSchema` (Zod) y `validateEnv()` |
| `src/config/configuration.ts` | `CONFIG_MODULE_OPTIONS`, token `APP_CONFIG`, `IAppConfig` y `buildAppConfig()` |
| `src/common/common.module.ts` | Importa `ConfigModule.forRoot(CONFIG_MODULE_OPTIONS)` y provee `APP_CONFIG` |

El flujo es:

```
process.env / .env
   → ConfigModule.forRoot({ isGlobal: false, validate: validateEnv })
   → envSchema.safeParse(...)          ← falla con "Invalid environment configuration"
   → buildAppConfig(env)               ← objeto IAppConfig tipado e inmutable
   → provider APP_CONFIG (exportado por CommonModule)
```

Los servicios inyectan la configuración tipada, nunca `process.env`:

```typescript
constructor(@Inject(APP_CONFIG) appConfig: IAppConfig) {
  this.config = requireRestCountriesConfig(appConfig);
}
```

Helpers del esquema:

| Helper | Comportamiento |
| --- | --- |
| `requiredString(min)` | Texto recortado con longitud mínima |
| `positiveInt(default)` | Entero positivo (acepta texto numérico) con valor por defecto |
| `strictBoolean(default)` | Solo `'true'` o `'false'`; cualquier otro valor es error |
| `optionalString()` | Texto recortado; vacío equivale a no definido |
| `optionalHttpUrl()` | Como el anterior, pero debe ser `http:` o `https:` |

`validateEnv()` lista solo **nombres de variables y mensajes de regla**, nunca los valores recibidos (pueden ser secretos).

---

## Patrón "opcional en el esquema, exigida por el módulo"

Las variables de cada infraestructura son opcionales en el esquema base, para que la base HTTP no dependa de ninguna base de datos. Cada módulo exige las suyas al construirse, con un error legible:

| Función | Archivo | Exige |
| --- | --- | --- |
| `requireMongoConfig()` | `src/database/mongo/mongo-config.ts` | `MONGO_URI` |
| `requireDynamoConfig()` | `src/database/dynamo/dynamo-config.ts` | `DYNAMODB_ENDPOINT` fuera de producción; `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` si hay endpoint |
| `requireRestCountriesConfig()` | `src/enrichment/enrichment-config.ts` | `REST_COUNTRIES_API_KEY` |
| `requireIdempotencyConfig()` | `src/validations/idempotency-config.ts` | `IDEMPOTENCY_HASH_SECRET` |
| `requireAuditConfig()` | `src/audit/audit-config.ts` | Coherencia entre `AUDIT_*`, `REQUEST_TIMEOUT_MS` y `DYNAMODB_TIMEOUT_MS` |

> **En la práctica todas son obligatorias para arrancar la aplicación**, porque `AppModule` importa `ValidationsModule` y este construye los servicios que las exigen. El patrón sirve para las pruebas (que levantan partes del sistema) y para dar mensajes claros.

Reglas de seguridad de DynamoDB (`requireDynamoConfig`):

- Fuera de `production`, `DYNAMODB_ENDPOINT` es obligatorio: omitirlo nunca debe enviar escrituras a una cuenta real de AWS.
- Con endpoint, las credenciales deben ser explícitas: nunca se toma la cadena de credenciales ambiental de AWS.

---

## Variables de entorno

Valores por defecto según `env.schema.ts`. La plantilla es `.env.example`; `.env` nunca se versiona.

### Generales

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` o `test` |
| `PORT` | `3000` | `.env.example` usa `3300` |
| `API_KEY` | — | **Obligatoria**, mínimo 32 caracteres. Se envía como `x-api-key` |
| `SWAGGER_ENABLED` | `false` | Swagger UI en `/docs` |
| `REQUEST_TIMEOUT_MS` | `15000` | Límite RxJS por request (`504`) |

### MongoDB

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `MONGO_URI` | — | Exigida por `MongoService`. Local: `mongodb://127.0.0.1:27018/?directConnection=true` |
| `MONGO_DB_NAME` | `external_validation` | |
| `MONGO_TIMEOUT_MS` | `5000` | `serverSelectionTimeoutMS`, `connectTimeoutMS` y `maxCommitTimeMS` |

### DynamoDB

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `DYNAMODB_ENDPOINT` | — | Obligatoria fuera de producción. Local: `http://127.0.0.1:8001` |
| `DYNAMODB_TABLE` | `validation_audit` | |
| `DYNAMODB_TIMEOUT_MS` | `2000` | Timeout de conexión y de solicitud del SDK (máximo 2 intentos) |
| `AWS_REGION` | `us-east-1` | |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Obligatorias con endpoint; en local, valores ficticios (`local`) |

### REST Countries

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `REST_COUNTRIES_BASE_URL` | `https://api.restcountries.com/countries/v5` | |
| `REST_COUNTRIES_API_KEY` | — | Exigida por `RestCountriesService`. Si **falta**, la aplicación no arranca; con el marcador de `.env.example` arranca, pero el proveedor rechaza la clave y el `POST` responde `502` |
| `HTTP_TIMEOUT_MS` | `5000` | Timeout de la llamada al proveedor (`504`) |

### Idempotencia

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `IDEMPOTENCY_HASH_SECRET` | — | Exigida por `ValidationsService`; mínimo 32 caracteres. Ver [`idempotencia.md`](./idempotencia.md#idempotency_hash_secret) |

### Auditoría (todas opcionales)

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `AUDIT_WORKER_ENABLED` | `true` | `false` desactiva el worker (pruebas HTTP) |
| `AUDIT_WORKER_INTERVAL_MS` | `15000` | Intervalo entre ciclos del worker |
| `AUDIT_BATCH_SIZE` | `20` | Máximo `500` |
| `AUDIT_LEASE_MS` | `60000` | Duración del lease de un evento reclamado |
| `AUDIT_INLINE_TIMEOUT_MS` | `1500` | Presupuesto máximo del intento inline |
| `AUDIT_BACKOFF_MAX_MS` | `300000` | Tope del backoff exponencial |

Restricciones validadas por `requireAuditConfig()`: `AUDIT_INLINE_TIMEOUT_MS < REQUEST_TIMEOUT_MS`, `AUDIT_LEASE_MS ≥ 10 × AUDIT_INLINE_TIMEOUT_MS` y `AUDIT_LEASE_MS > 8 × DYNAMODB_TIMEOUT_MS`. Ver [`auditoria-outbox.md`](./auditoria-outbox.md#configuración).

---

## Secuencia de arranque

```
main.ts
   ↓
NestFactory.create(AppModule)
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ Fase 1 — Configuración                                           │
│   ConfigModule valida el entorno con Zod                         │
│     └─ error → "Invalid environment configuration" y el proceso  │
│        termina                                                   │
│   APP_CONFIG = buildAppConfig(env)                               │
└──────────────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ Fase 2 — Construcción de providers                               │
│   Cada servicio llama a su require*Config() en el constructor    │
│     └─ variable faltante o incoherente → error legible           │
│   MongoService crea el MongoClient (aún sin conectar)            │
│   DynamoService crea los clientes del SDK (lazy: no contacta)    │
└──────────────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ Fase 3 — OnModuleInit                                            │
│   MongoService.onModuleInit()                                    │
│     └─ client.connect() + ping  ← si MongoDB no responde, el     │
│        arranque falla tras MONGO_TIMEOUT_MS                      │
└──────────────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ Fase 4 — configureApp(app)                                       │
│   x-powered-by deshabilitado, shutdown hooks, Swagger opcional   │
└──────────────────────────────────────────────────────────────────┘
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ Fase 5 — OnApplicationBootstrap                                  │
│   AuditRecoveryWorker (si AUDIT_WORKER_ENABLED=true)             │
│     ├─ lanza un primer ciclo SIN await: un DynamoDB caído no     │
│     │  bloquea el arranque                                       │
│     └─ setInterval(AUDIT_WORKER_INTERVAL_MS), con unref()        │
└──────────────────────────────────────────────────────────────────┘
   ↓
app.listen(PORT) → servicio atendiendo HTTP
```

Puntos clave:

- **MongoDB es dependencia de arranque**: sin él no hay transacciones ni lecturas; el proceso no inicia.
- **DynamoDB no lo es**: la auditoría es eventual (D-10). Con DynamoDB caído el servicio arranca, responde `201` y los eventos quedan `PENDING`.
- **REST Countries no se contacta al arrancar**; solo en cada `POST`.

---

## Apagado ordenado

`configureApp()` llama a `app.enableShutdownHooks()`. Al recibir `SIGTERM` o `SIGINT`:

| Componente | Acción en `onApplicationShutdown` |
| --- | --- |
| `AuditRecoveryWorker` | Deja de reclamar eventos, detiene el intervalo y espera el ciclo en curso hasta 5 s. Lo que quede a medias lo recupera el vencimiento del lease. |
| `MongoService` | `client.close()` |
| `DynamoService` | `client.destroy()` |

---

## Inicialización de infraestructura: `npm run infra:init`

```bash
npm run infra:init   # = nest build && node dist/database/init/init-infrastructure.js
```

| Archivo | Responsabilidad |
| --- | --- |
| `src/database/init/init-infrastructure.ts` | Punto de entrada: carga `.env` si existe, valida el entorno, aplica el guard de endpoint local y delega |
| `src/database/init/infrastructure-guards.ts` | `assertLocalDynamoEndpoint()`: solo `localhost`, `127.0.0.1` o `[::1]`; sin opción de omitirlo |
| `src/database/init/initialize-infrastructure.ts` | Lógica testeable; siempre libera ambos clientes |
| `src/database/init/initialize-mongo.ts` | Verifica el replica set y crea los índices de cada repositorio |
| `src/database/dynamo/dynamo-table.ts` | `ensureTable()` de DynamoDB |

Pasos, en orden:

1. Conecta a MongoDB y comprueba con `hello` que el nodo es **primario escribible de un replica set** (las transacciones lo exigen). No inicia el replica set: eso lo hace Docker Compose.
2. Crea los índices declarados por `CountryRepository`, `ValidationRepository` y `OutboxRepository` (ver [`mongodb-arquitectura.md`](./mongodb-arquitectura.md#colecciones-e-índices)).
3. Ejecuta el seed de países (`CO`, `MX`) con `$setOnInsert` + `upsert`: no duplica ni sobrescribe.
4. Crea la tabla DynamoDB si falta (`PK`/`SK` string, `PAY_PER_REQUEST`), espera a que exista y comprueba su esquema de llaves. Nunca borra ni recrea.

Salida típica en una base ya inicializada:

```
MongoDB: replica set primary verified, indexes ensured
MongoDB: countries seed inserted 0 new entries
DynamoDB: table "validation_audit" exists
```

Sin este paso, cualquier `POST /validations` responde `400 Unsupported country code`, porque el catálogo está vacío.

> **Al agregar un repositorio MongoDB nuevo**, se debe añadir a la lista de `initializeInfrastructure()` para que sus índices se creen.

---

## Entorno local con Docker Compose

| Servicio | Imagen | Puerto host | Detalles |
| --- | --- | --- | --- |
| `mongo` | `mongo:8.3.17` | `127.0.0.1:27018` | Replica set `rs0` de un nodo. El healthcheck lo inicia de forma idempotente y solo reporta *healthy* cuando el nodo es primario. Volumen `mongo_data`. |
| `dynamodb-local` | `amazon/dynamodb-local:3.3.2` | `127.0.0.1:8001` | `-sharedDb` y datos en el volumen `dynamo_data`. Corre como root para poder crear su archivo SQLite en el volumen. |

```bash
docker compose up -d
docker compose ps        # esperar a que mongo esté "healthy"
npm run infra:init
npm run start:dev
```

El miembro del replica set se anuncia como `localhost:27017`; los procesos del host se conectan con `directConnection=true` al puerto `27018`, por lo que el host anunciado nunca se usa para el descubrimiento. La aplicación no está incluida en `docker-compose.yml`.

---

## Qué ocurre si algo falla al arrancar

| Situación | Resultado |
| --- | --- |
| Variable con formato inválido (por ejemplo `API_KEY` corta) | El proceso no arranca: `Invalid environment configuration` con el nombre de la variable |
| Falta `MONGO_URI`, `REST_COUNTRIES_API_KEY` o `IDEMPOTENCY_HASH_SECRET` | El proceso no arranca: error del `require*Config()` correspondiente |
| Falta `DYNAMODB_ENDPOINT` fuera de producción | El proceso no arranca |
| `AUDIT_*` incoherentes | El proceso no arranca: error de `requireAuditConfig()` |
| MongoDB caído | El arranque falla tras `MONGO_TIMEOUT_MS` |
| MongoDB sin replica set | El servicio arranca, pero las transacciones fallan; `infra:init` lo detecta antes |
| DynamoDB caído | El servicio arranca; los eventos quedan `PENDING` y el worker reintenta |
| No se ejecutó `infra:init` | El servicio arranca, pero el `POST` responde `400 Unsupported country code` |
