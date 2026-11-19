# DynamoDB: SDK AWS v3 — Arquitectura

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Decisión técnica](#decisión-técnica)
2. [Componentes](#componentes)
3. [DynamoService: clientes del SDK](#dynamoservice-clientes-del-sdk)
4. [Salvaguardas contra AWS real](#salvaguardas-contra-aws-real)
5. [DynamoRepository: repositorio base](#dynamorepository-repositorio-base)
6. [Tabla `validation_audit`](#tabla-validation_audit)
7. [ValidationAuditRepository](#validationauditrepository)
8. [Diseño de llaves: por qué PK y SK](#diseño-de-llaves-por-qué-pk-y-sk)
9. [Patrones de acceso](#patrones-de-acceso)
10. [Privacidad](#privacidad)
11. [Inspeccionar los datos](#inspeccionar-los-datos)

---

## Decisión técnica

DynamoDB guarda el **historial de auditoría**: un ítem inmutable por cada validación creada, con llave por documento y fecha, como pide el enunciado. Se usa el SDK oficial de AWS v3 (`@aws-sdk/client-dynamodb` y `@aws-sdk/lib-dynamodb`) con **DynamoDB Local** en desarrollo (D-03).

Principios:

- **Ítems inmutables**: la única escritura es un `PutItem` condicional; no hay `put` incondicional, `update` ni `delete`.
- **Repositorio separado del de MongoDB**: las dos bases genéricas nunca se fusionan.
- **La escritura no participa de la transacción de MongoDB**: llega por el outbox (ver [`auditoria-outbox.md`](./auditoria-outbox.md)).

---

## Componentes

```
DynamoModule
  └── DynamoService
        ├── DynamoDBClient           (@aws-sdk/client-dynamodb)
        └── DynamoDBDocumentClient   (@aws-sdk/lib-dynamodb)
              ↑
        DynamoRepository<T>          (base genérica mínima)
              ↑
        ValidationAuditRepository    (llaves, ítem e identidad del evento)
```

| Componente | Archivo |
| --- | --- |
| `DynamoModule` | `src/database/dynamo/dynamo.module.ts` (no global; lo importa `AuditModule`) |
| `DynamoService` | `src/database/dynamo/dynamo.service.ts` |
| `requireDynamoConfig()` | `src/database/dynamo/dynamo-config.ts` |
| `DynamoRepository<T>` | `src/database/dynamo/dynamo.repository.ts` |
| `isConditionalCheckFailed()` | `src/database/dynamo/dynamo-errors.ts` |
| `ensureTable()` | `src/database/dynamo/dynamo-table.ts` |
| `ValidationAuditRepository`, `buildAuditKeys()` | `src/audit/repositories/validation-audit.repository.ts` |
| `IValidationAuditItem` | `src/audit/interfaces/audit-item.interface.ts` |

---

## DynamoService: clientes del SDK

```typescript
this.client = new DynamoDBClient({
  region: config.region,
  endpoint: config.endpoint,
  credentials: config.credentials,
  maxAttempts: 2,                               // 1 intento + 1 reintento
  requestHandler: {
    requestTimeout: config.timeoutMs,           // DYNAMODB_TIMEOUT_MS
    connectionTimeout: config.timeoutMs,
  },
});
this.documentClient = DynamoDBDocumentClient.from(this.client, {
  marshallOptions: { removeUndefinedValues: true },
});
```

- **Lazy**: crear los clientes no contacta a DynamoDB. Un DynamoDB caído nunca bloquea el arranque (la auditoría es eventual, D-10).
- **Latencia acotada**: como máximo 2 intentos por comando, cada uno limitado por `DYNAMODB_TIMEOUT_MS`.
- `onApplicationShutdown` llama a `client.destroy()`.
- El Document Client no admite `Date`: las fechas se guardan como texto ISO.

---

## Salvaguardas contra AWS real

| Salvaguarda | Dónde | Regla |
| --- | --- | --- |
| Endpoint obligatorio fuera de producción | `requireDynamoConfig()` | Sin `DYNAMODB_ENDPOINT` y con `NODE_ENV` distinto de `production`, el módulo no se construye. Omitir la variable nunca envía escrituras a una cuenta real. |
| Credenciales explícitas con endpoint | `requireDynamoConfig()` | Con endpoint, `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` son obligatorias: no se usa la cadena de credenciales ambiental. |
| Solo host local en scripts y pruebas | `assertLocalDynamoEndpoint()` | `infra:init` y las pruebas de integración solo aceptan `localhost`, `127.0.0.1` o `[::1]`. Sin opción de omitirlo. |
| Recursos de prueba aislados | `test/support/integration-env.ts` | Las pruebas crean tablas `ev_test_<uuid>` y solo borran tablas con ese prefijo. |

---

## DynamoRepository: repositorio base

```typescript
export interface IDynamoItem { readonly PK: string; readonly SK: string; }

export abstract class DynamoRepository<T extends IDynamoItem> {
  putIfNotExists(item: T, options?: { abortSignal?: AbortSignal }): Promise<void>;
  getByKey(pk: string, sk: string, options?): Promise<T | undefined>;
  queryByPartition(pk: string, options?: { limit?: number }): Promise<T[]>;
}
```

| Método | Comando | Detalles |
| --- | --- | --- |
| `putIfNotExists` | `PutCommand` con `ConditionExpression: 'attribute_not_exists(PK)'` | Falla con `ConditionalCheckFailedException` si ya existe un ítem con esa llave completa. |
| `getByKey` | `GetCommand` con `ConsistentRead: true` | Lectura consistente, necesaria para verificar un replay. |
| `queryByPartition` | `QueryCommand` sobre `PK`, `ScanIndexForward: true`, `ConsistentRead: true` | Orden cronológico ascendente por `SK`. Sin paginación: solo `limit`. |

- No captura ni envuelve errores del servicio.
- `abortSignal` permite cancelar un comando cuando vence el presupuesto de la publicación inline. Un comando abortado deja el resultado **ambiguo**: nunca se interpreta como éxito.
- `isConditionalCheckFailed(error)` identifica el rechazo condicional sin modificarlo.

---

## Tabla `validation_audit`

| Propiedad | Valor |
| --- | --- |
| Nombre | `DYNAMODB_TABLE` (por defecto `validation_audit`) |
| Llave de partición | `PK` (string, `HASH`) |
| Llave de ordenamiento | `SK` (string, `RANGE`) |
| Facturación | `PAY_PER_REQUEST` |
| Índices secundarios | Ninguno |

La crea `ensureTable()` durante `npm run infra:init`:

1. `DescribeTable`; si no existe, `CreateTable` (un `ResourceInUseException` concurrente no es error).
2. Espera hasta 30 s a que la tabla exista.
3. Comprueba que el esquema de llaves sea exactamente `PK`/`SK` string; si no, falla.
4. Nunca borra ni recrea una tabla.

---

## ValidationAuditRepository

### Construcción de llaves (única función)

```typescript
export function buildAuditKeys(countryCode, documentNumber, occurredAt, eventId) {
  return {
    pk: `DOCUMENT#${countryCode}#${documentNumber}`,
    sk: `${occurredAt.toISOString()}#${eventId}`,
  };
}
```

### Ítem de auditoría

```typescript
export interface IValidationAuditItem extends IDynamoItem {
  readonly eventId: string;        // UUID estable, generado una vez
  readonly validationId: string;   // _id de la validación en MongoDB
  readonly eventType: 'VALIDATION_CREATED';
  readonly countryCode: string;
  readonly createdAt: string;      // ISO UTC = createdAt de la validación
  readonly schemaVersion: number;  // 1
}
```

Ejemplo:

```json
{
  "PK": "DOCUMENT#CO#TEST-123456",
  "SK": "2026-11-19T15:30:00.000Z#4b0f8f2e-6c1d-4f5a-9e7b-2d3c4b5a6f70",
  "eventId": "4b0f8f2e-6c1d-4f5a-9e7b-2d3c4b5a6f70",
  "validationId": "6740f1c2a1b2c3d4e5f60718",
  "eventType": "VALIDATION_CREATED",
  "countryCode": "CO",
  "createdAt": "2026-11-19T15:30:00.000Z",
  "schemaVersion": 1
}
```

El número de documento **solo** aparece en la `PK`; no se duplica como atributo.

### Métodos

| Método | Descripción |
| --- | --- |
| `static buildItem(event)` | Construye el ítem a partir del evento del outbox. Es puro y determinista: el mismo evento produce siempre el mismo ítem, en todos los reintentos. |
| `static isSameEvent(existing, expected)` | `true` solo si coinciden `PK`, `SK`, `eventId`, `validationId`, `eventType`, `countryCode`, `createdAt` y `schemaVersion`. |
| `findExisting(item)` | `getByKey(item.PK, item.SK)` consistente. |
| `listByDocument(countryCode, documentNumber, limit?)` | Historial cronológico de un documento. Lo usan las pruebas; no hay endpoint HTTP (no lo pide el enunciado). |

### Escritura idempotente

```
putIfNotExists(item)
  ├─ éxito                         → evidencia: el evento está guardado
  └─ ConditionalCheckFailed
       → findExisting(item)
           ├─ no existe            → AuditItemMissingError (transitorio, reintentar)
           ├─ misma identidad      → replay válido: el evento ya estaba guardado
           └─ identidad distinta   → AuditKeyCollisionError (permanente, FAILED)
```

Una falla condicional **nunca** se asume como éxito: puede tratarse de otro evento con la misma llave. Ver [`auditoria-outbox.md`](./auditoria-outbox.md#publicación-de-un-evento).

---

## Diseño de llaves: por qué PK y SK

```text
PK = DOCUMENT#<countryCode>#<documentNumber>
SK = <fecha ISO UTC>#<eventId>
```

**Partición por país y documento (D-21, revisión de D-09).** El enunciado pide una llave por documento y fecha. Con el documento en la partición, todo su historial se lee con un `Query` eficiente, sin escaneos. Se incluye el país porque el mismo número puede existir en países distintos y sus historiales no deben mezclarse. El código de país tiene ancho fijo de dos letras, así que la llave no es ambigua aunque el documento contenga `#`.

Alternativas evaluadas:

| Opción | PK | Resultado |
| --- | --- | --- |
| A | `DOCUMENT#<doc>` | Rechazada: mezcla historiales del mismo número en distintos países. |
| **B** | `DOCUMENT#<país>#<doc>` | **Elegida**: sin secretos adicionales y sigue siendo una llave por documento y fecha. No hubo costo de migración. |
| C | HMAC de país + documento | Mejora futura de producción: protege el número, pero exige un secreto adicional y su rotación cambia las PK de ítems inmutables. |

**Ordenamiento por fecha y desempate por `eventId`.** La fecha ISO UTC tiene ancho fijo, así que el orden lexicográfico es el cronológico. El `eventId` desempata eventos del mismo milisegundo y hace que cada reintento escriba **exactamente** la misma llave, lo que permite la escritura condicional idempotente.

---

## Patrones de acceso

| Necesidad | Operación | Soportado |
| --- | --- | --- |
| Historial de un documento en un país, en orden cronológico | `Query` por `PK` | ✅ |
| Un evento concreto | `GetItem` por `PK` + `SK` | ✅ |
| Eventos por `validationId` o por rango de fechas entre documentos | Requeriría un índice secundario | ❌ (no se necesita hoy) |

La `PK` distingue mayúsculas y minúsculas y no recorta espacios: `TEST-123456` y `test-123456` son documentos distintos. El servicio guarda el documento tal como llega (solo recortado), porque no debe alterar formatos documentales legítimos.

---

## Privacidad

El número de documento forma parte de la `PK`, como exige el enunciado. Mitigaciones actuales: no se duplica como atributo, ningún log lo registra y las pruebas usan datos ficticios. En producción se recomienda derivar la partición con un HMAC (opción C) y restringir el acceso a la tabla.

---

## Inspeccionar los datos

Ver la sección "Inspeccionar los datos locales" del [README](../../README.md#inspeccionar-los-datos-locales): `list-tables`, `scan`, `query` y `execute-statement` (PartiQL) contra DynamoDB Local con credenciales ficticias.
