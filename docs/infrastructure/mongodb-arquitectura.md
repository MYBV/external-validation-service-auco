# MongoDB: Driver Nativo — Arquitectura

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Decisión técnica](#decisión-técnica)
2. [Componentes](#componentes)
3. [MongoService: cliente y transacciones](#mongoservice-cliente-y-transacciones)
4. [MongoRepository: repositorio base](#mongorepository-repositorio-base)
5. [Colecciones e índices](#colecciones-e-índices)
6. [Repositorios en uso](#repositorios-en-uso)
7. [Manejo de errores del driver](#manejo-de-errores-del-driver)
8. [Límites de tiempo del driver](#límites-de-tiempo-del-driver)
9. [Cómo crear un nuevo repositorio](#cómo-crear-un-nuevo-repositorio)
10. [Inspeccionar los datos](#inspeccionar-los-datos)

---

## Decisión técnica

Se usa exclusivamente el **driver oficial `mongodb`** (versión 7.9), sin Mongoose ni otro ODM (D-02):

- El servicio tiene tres colecciones con esquemas pequeños y validados por Zod en la entrada; un ODM no aporta validación adicional útil.
- Las garantías clave (transacciones, índices únicos parciales, `findOneAndUpdate` atómico para el lease del outbox) se expresan mejor con la API nativa.
- Los errores del driver (`E11000`, etiquetas de transacción) llegan intactos a la capa de aplicación, que decide cómo interpretarlos.

**Topología:** un único `MongoClient` por proceso, una única base de datos (`MONGO_DB_NAME`, por defecto `external_validation`) y un **replica set obligatorio** (`rs0`), porque la validación y su evento de auditoría se guardan en una transacción.

---

## Componentes

| Componente | Archivo | Responsabilidad |
| --- | --- | --- |
| `MongoModule` | `src/database/mongo/mongo.module.ts` | Provee y exporta `MongoService`. No es global. |
| `MongoService` | `src/database/mongo/mongo.service.ts` | Dueño del `MongoClient`: conexión, cierre y `withTransaction()`. |
| `requireMongoConfig()` | `src/database/mongo/mongo-config.ts` | Exige `MONGO_URI` con un error legible. |
| `MongoRepository<T>` | `src/database/mongo/mongo.repository.ts` | Base mínima: `create`, `findById`, `findOne`, `ensureIndexes`. |
| Helpers de error | `src/database/mongo/mongo-errors.ts` | Clasifican errores del driver sin modificarlos. |
| `initializeMongo()` | `src/database/init/initialize-mongo.ts` | Verifica el replica set y crea índices (`infra:init`). |

```
MongoModule
  └── MongoService ── MongoClient (uno por proceso) ── Db (MONGO_DB_NAME)
                                                        ├── countries
                                                        ├── validations
                                                        └── audit_outbox
       ↑ inyectado en
  CountryRepository, ValidationRepository, OutboxRepository  (extienden MongoRepository<T>)
```

`MongoModule` lo importan `CountriesModule`, `ValidationsModule` y `AuditModule`. NestJS reutiliza la misma instancia del módulo, así que todos comparten **el mismo** `MongoService`.

---

## MongoService: cliente y transacciones

### Conexión

```typescript
this.client = new MongoClient(config.uri, {
  serverSelectionTimeoutMS: config.timeoutMs, // MONGO_TIMEOUT_MS
  connectTimeoutMS: config.timeoutMs,
});
this.db = this.client.db(config.dbName);
```

| Hook | Acción |
| --- | --- |
| `onModuleInit` | `client.connect()` y `ping`. Si falla, el arranque de la aplicación falla. |
| `onApplicationShutdown` | `client.close()` |

`MongoService` también puede construirse a mano (lo hacen `infra:init` y las pruebas de integración).

### Transacciones: `withTransaction()`

```typescript
const BASE_TRANSACTION_OPTIONS: TransactionOptions = {
  readConcern: { level: 'majority' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

async withTransaction<R>(work: (session: ClientSession) => Promise<R>): Promise<R> {
  const session = this.client.startSession();
  try {
    return await session.withTransaction(() => work(session), {
      ...BASE_TRANSACTION_OPTIONS,
      maxCommitTimeMS: config.timeoutMs,
    });
  } finally {
    await session.endSession();
  }
}
```

Reglas para quien escribe el callback `work`:

1. **Pasar la misma `session`** a todas las operaciones de la transacción.
2. **El callback debe ser idempotente**: ante errores transitorios el driver lo vuelve a ejecutar. Los IDs, fechas y documentos se generan **fuera** del callback.
3. **No hacer llamadas HTTP ni a DynamoDB dentro**: la transacción debe ser corta.
4. El error original se relanza sin cambios; quien llama decide cómo interpretarlo.

Uso real en `ValidationsService`:

```typescript
private store(pending: IPendingWrite): Promise<void> {
  return this.mongo.withTransaction(async (session) => {
    await this.validations.create({ _id: pending.validationId, ...pending.validation }, session);
    await this.outbox.create({ ...pending.event }, session);
  });
}
```

Si cualquiera de las dos inserciones falla, ninguna queda guardada. Las pruebas de integración lo verifican contra un replica set real (`test/integration/mongo.int-spec.ts` y `validations.int-spec.ts`).

---

## MongoRepository: repositorio base

```typescript
export abstract class MongoRepository<T extends Document> {
  protected readonly indexes: readonly IndexDescription[] = [];
  protected readonly collection: Collection<T>;

  protected constructor(mongo: MongoService, collectionName: string) {
    this.collection = mongo.db.collection<T>(collectionName);
  }

  create(document, session?)    // insertOne → insertedId
  findById(id, session?)        // findOne({ _id })
  findOne(filter, session?)
  ensureIndexes()               // createIndexes(this.indexes), idempotente
}
```

Es deliberadamente pequeño (D-02):

- **Sí** tiene: operaciones que usa más de un repositorio, soporte de `ClientSession` y la creación declarativa de índices.
- **No** tiene: soft delete, paginación, `update`/`delete` genéricos, logging, `process.exit()` ni captura de errores. Las consultas de dominio las implementa cada repositorio concreto.
- `ensureIndexes()` es idempotente: no borra índices; si un índice existe con otra definición, el error del driver se propaga.

---

## Colecciones e índices

| Colección | Documento | Índices |
| --- | --- | --- |
| `countries` | `ICountry`: `code`, `name`, `enabled`, `createdAt`, `updatedAt` | `code_unique`: `{ code: 1 }` único |
| `validations` | `IValidation`: `name`, `documentNumber`, `countryCode`, `enrichment`, `createdAt`, `idempotencyKey?`, `requestFingerprint?` | `idempotencyKey_unique`: `{ idempotencyKey: 1 }` único **parcial** (`partialFilterExpression: { idempotencyKey: { $type: 'string' } }`) |
| `audit_outbox` | `IOutboxEvent`: ver [`auditoria-outbox.md`](./auditoria-outbox.md#el-evento-del-outbox) | `eventId_unique`: `{ eventId: 1 }` único · `status_nextAttemptAt`: `{ status: 1, nextAttemptAt: 1 }` |

Notas:

- El índice parcial de `validations` solo indexa documentos con `idempotencyKey`: se pueden crear validaciones sin clave sin que choquen entre sí. Es el árbitro de la concurrencia en la idempotencia HTTP (ver [`idempotencia.md`](./idempotencia.md)).
- `status_nextAttemptAt` sirve tanto para buscar eventos pendientes como para el claim con lease.
- Los índices los crea `npm run infra:init`, no el arranque de la aplicación.

---

## Repositorios en uso

### CountryRepository (`src/countries/repositories/country.repository.ts`)

| Método | Descripción |
| --- | --- |
| `findByCode(code)` | Busca un país por código ISO alfa-2 en mayúsculas. |
| `seed(countries)` | `updateOne({ code }, { $setOnInsert }, { upsert: true })` por país; devuelve cuántos se insertaron. Nunca sobrescribe. |

### ValidationRepository (`src/validations/repositories/validation.repository.ts`)

| Método | Descripción |
| --- | --- |
| `create` / `findById` | Heredados de la base. `_id` lo genera el servicio **antes** de la transacción. |
| `findByIdempotencyKey(key)` | Búsqueda temprana de replay y lectura del "ganador" tras una colisión. |

### OutboxRepository (`src/audit/repositories/outbox.repository.ts`)

| Método | Descripción |
| --- | --- |
| `create` | Heredado; se usa dentro de la transacción de la validación. |
| `claimNext(now, leaseMs, token)` | Reclama atómicamente el evento `PENDING` elegible más antiguo (`findOneAndUpdate`). |
| `claimById(eventId, now, leaseMs, token)` | Igual, para un evento concreto (publicación inline). Nunca roba un lease vigente. |
| `markPublished(eventId, validationId, now)` | `PENDING → PUBLISHED`; exige evidencia de persistencia en DynamoDB. |
| `markRetry(...)` / `markFailed(...)` | Programan reintento o marcan `FAILED`; solo si el intento conserva su `claimToken`. |

---

## Manejo de errores del driver

Los repositorios **no capturan** errores. La capa de aplicación los clasifica con helpers que nunca los modifican:

| Helper | Devuelve `true` cuando |
| --- | --- |
| `isDuplicateKeyError(error)` | Es un `MongoServerError` con código `11000` (E11000). |
| `isDuplicateKeyOnIndex(error, indexName, keyField)` | Es un E11000 del índice indicado (por `keyPattern` o, si falta, por el nombre en el mensaje). |
| `isTransientMongoError(error)` | Tiene la etiqueta `TransientTransactionError` o `UnknownTransactionCommitResult`, o es un `WriteConflict` (código `112`). |
| `isUnknownCommitResult(error)` | Tiene la etiqueta `UnknownTransactionCommitResult`: el commit **pudo** haberse aplicado. |

Ejemplo: en la persistencia idempotente, un E11000 de `idempotencyKey_unique` significa "otra solicitud ganó la clave", un E11000 del propio `_id` significa "mi intento anterior sí se guardó", y un E11000 de cualquier otro índice se relanza sin cambios (ver [`idempotencia.md`](./idempotencia.md#persistencia-acotada-y-errores-interpretados)).

---

## Límites de tiempo del driver

Hallazgos verificados con el driver instalado (7.9.0):

| Mecanismo | Efecto real |
| --- | --- |
| `timeoutMS` en `withTransaction()` | **Deprecado y sin efecto**. No se usa. |
| `maxCommitTimeMS` | Acota el `commitTransaction` en el servidor. Se fija con `MONGO_TIMEOUT_MS`. Al expirar, el driver **no** reintenta y lanza un error con `UnknownTransactionCommitResult`. |
| Plazo interno de `withTransaction()` | 120 s entre reintentos; no interrumpe operaciones en curso. |
| `socketTimeoutMS` | No configurado (por defecto sin límite). Afectaría también a las transacciones; queda como mejora a evaluar. |

Consecuencias:

- **Un commit que expira no implica rollback.** En una prueba con un límite de 1 ms, parte de los commits expirados quedaron guardados y otros no. Por eso el servicio busca su propio registro por `_id` antes de decidir.
- El resto de la transacción no tiene un límite propio, y el timeout del request no la cancela.
- Una operación de MongoDB que nunca responda podría bloquear el ciclo del worker de auditoría hasta reiniciar; el worker lo detecta y lo registra (ver [`auditoria-outbox.md`](./auditoria-outbox.md#worker-de-recuperación)).

---

## Cómo crear un nuevo repositorio

### Paso 1: Definir la interface del documento

```typescript
// src/<módulo>/interfaces/example.interface.ts
export interface IExample {
  code: string;
  createdAt: Date;
}
```

### Paso 2: Crear el repositorio

```typescript
// src/<módulo>/repositories/example.repository.ts
export const EXAMPLES_COLLECTION = 'examples';

@Injectable()
export class ExampleRepository extends MongoRepository<IExample> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { code: 1 }, name: 'code_unique', unique: true },
  ];

  constructor(mongo: MongoService) {
    super(mongo, EXAMPLES_COLLECTION);
  }

  findByCode(code: string): Promise<WithId<IExample> | null> {
    return this.findOne({ code });
  }
}
```

### Paso 3: Registrar en el módulo

```typescript
@Module({
  imports: [MongoModule],
  providers: [ExampleRepository, ExampleService],
})
export class ExampleModule {}
```

### Paso 4: Registrar sus índices en `infra:init`

Añadir `new ExampleRepository(mongo)` a la lista de `initializeInfrastructure()` en `src/database/init/initialize-infrastructure.ts`.

### Paso 5: Probar

- Unitarias con dobles del repositorio.
- Integración contra el replica set con una base aislada `ev_test_<uuid>` (ver `test/support/integration-env.ts`); nunca contra `external_validation`.

---

## Inspeccionar los datos

Ver la sección "Inspeccionar los datos locales" del [README](../../README.md#inspeccionar-los-datos-locales-): `docker compose exec mongo mongosh`, `use external_validation`, `show collections` y consultas de ejemplo por colección.
