# Auditoría: Outbox Transaccional, Publicación y Recuperación

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [El problema](#el-problema)
2. [Decisión: 201 tras el commit de MongoDB](#decisión-201-tras-el-commit-de-mongodb)
3. [Componentes](#componentes)
4. [El evento del outbox](#el-evento-del-outbox)
5. [Ciclo de vida de un evento](#ciclo-de-vida-de-un-evento)
6. [Claim con lease y fencing](#claim-con-lease-y-fencing)
7. [Publicación de un evento](#publicación-de-un-evento)
8. [Publicación inline](#publicación-inline)
9. [Worker de recuperación](#worker-de-recuperación)
10. [Clasificación de errores y backoff](#clasificación-de-errores-y-backoff)
11. [Configuración](#configuración)
12. [Escenarios de fallo](#escenarios-de-fallo)
13. [Garantías y límites](#garantías-y-límites)
14. [Observabilidad](#observabilidad)

---

## El problema

Cada validación creada debe producir un evento de auditoría en **DynamoDB**, pero la validación se guarda en **MongoDB**. No existe una transacción que abarque ambas bases: si se escriben por separado, cualquiera de las dos puede fallar después de la otra.

- Escribir primero en DynamoDB puede dejar un evento sin validación.
- Escribir primero en MongoDB y fallar en DynamoDB deja una validación sin auditoría.

La solución es un **outbox transaccional**: el evento se guarda en MongoDB **junto con** la validación, en la misma transacción, y después se entrega a DynamoDB con reintentos e idempotencia.

---

## Decisión: 201 tras el commit de MongoDB

El enunciado no define qué hacer en un fallo parcial. La política elegida es una **decisión propia** (D-10):

- El **commit** de la transacción (validación + evento `PENDING`) es el punto de confirmación: se responde `201 Created`.
- Un fallo de DynamoDB **posterior** al commit **no** convierte la respuesta en error: el evento queda `PENDING` y se entrega después.
- Si el commit falla, la creación falla y no se responde `201`.

Alternativas descartadas:

| Alternativa | Por qué no |
| --- | --- |
| Responder `503` si DynamoDB falla | Diría que la creación falló cuando la validación ya existe, y empujaría al cliente a reintentar; sin `Idempotency-Key`, crearía un duplicado. |
| Responder `202 Accepted` | `202` indica procesamiento pendiente, pero el recurso ya está creado y se puede consultar. |
| Escribir en DynamoDB dentro de la operación | No hay transacción entre ambas bases; una de las escrituras puede quedar huérfana. |

> `201` **no** significa que el evento ya sea visible en DynamoDB. La garantía es **entrega eventual at-least-once con efecto idempotente**.

---

## Componentes

`AuditModule` (no global) importa `MongoModule` y `DynamoModule` y exporta `OutboxRepository` y `AuditPublisher`.

| Componente | Archivo | Responsabilidad |
| --- | --- | --- |
| `OutboxRepository` | `src/audit/repositories/outbox.repository.ts` | Colección `audit_outbox`: crear, reclamar y cambiar estado de eventos. |
| `ValidationAuditRepository` | `src/audit/repositories/validation-audit.repository.ts` | Llaves, ítem y comparación de identidad en DynamoDB. |
| `AuditPublisher` | `src/audit/services/audit-publisher.service.ts` | `publishInline()`, `processPendingBatch()` y `publishClaimed()`. |
| `AuditRecoveryWorker` | `src/audit/services/audit-recovery.worker.ts` | Solo temporización: ciclos al arrancar y periódicos. |
| `classifyAuditError()` y errores propios | `src/audit/audit-errors.ts` | Transitorio vs permanente; códigos seguros para guardar y registrar. |
| `computeBackoffMs()` | `src/audit/utils/audit-backoff.util.ts` | Backoff exponencial con tope y jitter. |
| `requireAuditConfig()` | `src/audit/audit-config.ts` | Validación de coherencia de la configuración. |

No se añadieron dependencias: el worker usa `setInterval` nativo; no hay colas ni SQS.

---

## El evento del outbox

```typescript
export interface IOutboxEvent {
  eventId: string;            // UUID generado una vez, antes de la transacción
  validationId: ObjectId;     // = validations._id
  eventType: 'VALIDATION_CREATED';
  documentNumber: string;     // sensible: nunca se registra en logs
  countryCode: string;
  occurredAt: Date;           // = validations.createdAt
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;           // 0 al crear; cada claim suma 1
  nextAttemptAt: Date;        // = occurredAt al crear; hace de lease y de backoff
  publishedAt?: Date;
  claimToken?: string;        // dueño del claim vigente (fencing)
  lastAttemptAt?: Date;
  lastErrorCode?: string;     // solo nombre o código, nunca mensajes
  lastErrorAt?: Date;
  failedAt?: Date;
}
```

El evento contiene todo lo necesario para **reconstruir de forma determinista** el ítem de DynamoDB en cada intento: mismo `eventId`, misma `PK`, misma `SK` y mismo contenido.

---

## Ciclo de vida de un evento

```
          transacción MongoDB (validación + evento)
                         │
                         ▼
               ┌───────────────────┐
               │      PENDING      │◄────────────────────────────┐
               │ nextAttemptAt=now │                             │
               └─────────┬─────────┘                             │
                         │ claim (inline o worker)               │
                         ▼                                       │
          ┌──────────────────────────────┐                       │
          │ PENDING con lease             │                       │
          │ nextAttemptAt = now + lease   │                       │
          │ claimToken = <uuid>           │                       │
          └──────┬───────────┬────────────┘                       │
                 │           │                                    │
   evidencia de  │           │ error transitorio                  │
   persistencia  │           │ → markRetry: nextAttemptAt =       │
                 │           │   fallo + backoff ─────────────────┘
                 │           │
                 │           │ error permanente (colisión real,
                 │           │ evento inválido) → markFailed
                 ▼           ▼
        ┌──────────────┐  ┌──────────────┐
        │  PUBLISHED   │  │    FAILED    │
        │  (terminal)  │  │  (terminal,  │
        └──────────────┘  │   manual)    │
                          └──────────────┘

Si el proceso muere con un claim vigente, el lease vence (nextAttemptAt
queda en el pasado) y el evento vuelve a ser elegible.
```

No existe un estado `CLAIMED` ni un campo `leaseExpiresAt`: el lease **es** `nextAttemptAt`.

---

## Claim con lease y fencing

La publicación inline y el worker pueden competir por el mismo evento, incluso con una sola instancia (D-22). Reclamar es una **única actualización atómica**:

```typescript
collection.findOneAndUpdate(
  { status: 'PENDING', nextAttemptAt: { $lte: now } },        // + eventId en claimById
  {
    $set: { nextAttemptAt: now + leaseMs, claimToken: token, lastAttemptAt: now },
    $inc: { attempts: 1 },
  },
  { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
);
```

| Transición | Filtro | Por qué |
| --- | --- | --- |
| `markRetry` | `{ eventId, status: 'PENDING', claimToken }` | Un intento viejo (lease vencido o inline que excedió su presupuesto) no puede pisar el estado de un claim nuevo. |
| `markFailed` | `{ eventId, status: 'PENDING', claimToken }` | Igual. |
| `markPublished` | `{ eventId, validationId, status: 'PENDING' }` | Exige **evidencia** de que el ítem correcto está en DynamoDB. La evidencia pertenece al evento, no al intento, así que no exige el token. |

El worker reclama **de uno en uno** dentro de un lote, para que ningún lease venza mientras su evento espera turno.

---

## Publicación de un evento

`AuditPublisher.publishClaimed(event, now, abortSignal?)`:

```
1. item = ValidationAuditRepository.buildItem(event)
     └─ si el evento no se puede transformar → AuditItemInvalidError (permanente)

2. putIfNotExists(item)  [ConditionExpression: attribute_not_exists(PK)]
     ├─ éxito → evidencia ✓
     └─ ConditionalCheckFailedException
          → getByKey(PK, SK) consistente
               ├─ no existe          → AuditItemMissingError (transitorio)
               ├─ misma identidad    → evidencia ✓ (replay: ya estaba guardado)
               └─ otra identidad     → AuditKeyCollisionError (permanente)

3. Con evidencia → markPublished(eventId, validationId)
     ├─ actualizado     → 'published'
     ├─ no actualizado  → 'stale' (otro intento ya lo publicó)
     └─ error de Mongo  → 'unsettled' (el ítem está en DynamoDB; el lease vencerá
                           y el siguiente intento chocará con su propio ítem,
                           lo verificará y lo marcará PUBLISHED sin duplicar)

4. Sin evidencia → settleFailure: markRetry (transitorio) o markFailed (permanente)
```

Un timeout, un abort, una colisión con otro evento o un ítem ilegible **nunca** llegan a `PUBLISHED`.

---

## Publicación inline

Tras un commit confirmado, `ValidationsService` llama a `publishInline(eventId, requestStartedAt)` **fuera** de la transacción (D-10, D-24). Se invoca en:

- El commit normal.
- Un commit incierto (`UnknownTransactionCommitResult`) comprobado al encontrar el propio `validationId`, con o sin `Idempotency-Key`.
- Con `Idempotency-Key`, cuando el reintento choca con su propio `_id` o cuando el ganador de la clave resulta ser un intento anterior de la misma solicitud.

No se invoca en los replays idempotentes de otra solicitud (ese evento ya tiene su propia entrega).

### Presupuesto

```typescript
inlineBudgetMs(requestStartedAt?: Date): number {
  if (requestStartedAt === undefined) return AUDIT_INLINE_TIMEOUT_MS;
  const remaining = REQUEST_TIMEOUT_MS - (now - requestStartedAt) - 500; // margen de respuesta
  return Math.min(AUDIT_INLINE_TIMEOUT_MS, remaining);
}
```

- Si el presupuesto es **menor a 100 ms**, el intento inline se **omite** (sin claim ni llamada a DynamoDB) y el evento queda para el worker.
- El presupuesto cubre la operación **completa** (claim en MongoDB + Put/Get en DynamoDB + actualización de estado), con `Promise.race` y un `AbortSignal` para el SDK.
- `publishInline()` **nunca lanza**, y `ValidationsService` además ignora cualquier error: el `201` no depende de la auditoría.
- Las llamadas a MongoDB no se pueden cancelar: una operación que excede su presupuesto puede seguir corriendo. Es seguro porque el abort deja el resultado ambiguo (no publica) y las transiciones están protegidas por `claimToken`.

`startedAt` viene del contexto de la solicitud (ver [`request-context.md`](./request-context.md)). El cálculo evita que la auditoría empuje la respuesta más allá de `REQUEST_TIMEOUT_MS`, pero no cancela una transacción de MongoDB en curso: un commit lento puede, por sí solo, agotar el tiempo del request.

**Costo conocido:** mientras DynamoDB esté caído, cada `POST` puede tardar hasta `AUDIT_INLINE_TIMEOUT_MS` adicionales (no hay circuit breaker, D-25).

---

## Worker de recuperación

`AuditRecoveryWorker` solo se encarga de la temporización; el trabajo lo hace `AuditPublisher.processPendingBatch()`.

| Momento | Comportamiento |
| --- | --- |
| `onApplicationBootstrap` | Si `AUDIT_WORKER_ENABLED=true`, lanza un primer ciclo **sin `await`** (un DynamoDB caído no bloquea el arranque) y un `setInterval` cada `AUDIT_WORKER_INTERVAL_MS` con `unref()`. |
| Cada ciclo | Reclama y procesa hasta `AUDIT_BATCH_SIZE` eventos elegibles, de uno en uno. |
| Solapamiento | Nunca hay dos ciclos a la vez: si uno sigue en curso, el siguiente se omite. |
| Ciclo bloqueado | Si un ciclo supera `2 × AUDIT_LEASE_MS`, registra **una vez** un error. No abandona el ciclo (eso permitiría ciclos concurrentes y trabajo huérfano). |
| `onApplicationShutdown` | No reclama más, detiene el intervalo y espera el ciclo en curso hasta 5 s. |
| Errores | Se capturan y registran por nombre; el worker sigue funcionando. |

El worker **no** usa el contexto de la solicitud. Las pruebas pueden invocar `processPendingBatch(limit, { now })` directamente, sin temporizadores reales.

---

## Clasificación de errores y backoff

### Permanentes (`FAILED`)

| Código | Situación |
| --- | --- |
| `AUDIT_KEY_COLLISION` | Ya existe en DynamoDB otro evento con la misma llave. El ítem existente nunca se sobrescribe. |
| `AUDIT_ITEM_INVALID` | El evento del outbox no se puede transformar en ítem. |

### Transitorios (reintento)

**Todo lo demás**: timeouts, red, 5xx, throttling, tabla inexistente, credenciales, `ValidationException`, `AUDIT_ITEM_MISSING`, `AUDIT_ABORTED`, errores de MongoDB y errores desconocidos (D-23).

Los errores transitorios **nunca** pasan a `FAILED` por número de intentos: una caída larga no debe perder auditoría. Errores como una tabla mal configurada o credenciales inválidas los puede corregir un operador; marcarlos como permanentes habría perdido eventos por un error de configuración (hallazgo M-1 de la revisión).

### Backoff

```
retraso = min(5 s × 2^(attempts − 1), AUDIT_BACKOFF_MAX_MS) × (1 ± 20 % de jitter)
```

Se programa desde el **momento del fallo** (`now` del intento + el tiempo real que consumió). `attempts` y `lastErrorCode` dan observabilidad.

---

## Configuración

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `AUDIT_WORKER_ENABLED` | `true` | Activa el worker. |
| `AUDIT_WORKER_INTERVAL_MS` | `15000` | Intervalo entre ciclos. |
| `AUDIT_BATCH_SIZE` | `20` | Eventos por ciclo (máximo 500). |
| `AUDIT_LEASE_MS` | `60000` | Duración del lease de un evento reclamado. |
| `AUDIT_INLINE_TIMEOUT_MS` | `1500` | Presupuesto máximo del intento inline. |
| `AUDIT_BACKOFF_MAX_MS` | `300000` | Tope del backoff. |

Validaciones al arrancar (`requireAuditConfig`):

| Regla | Motivo |
| --- | --- |
| `AUDIT_INLINE_TIMEOUT_MS < REQUEST_TIMEOUT_MS` | Comprobación de coherencia (la protección real es el presupuesto por request). |
| `AUDIT_LEASE_MS ≥ 10 × AUDIT_INLINE_TIMEOUT_MS` | El lease debe cubrir una operación inline que excedió su presupuesto. |
| `AUDIT_LEASE_MS > 8 × DYNAMODB_TIMEOUT_MS` | Peor caso de una publicación: timeout de conexión + de solicitud (×2), 2 intentos del SDK (×2), y un `Put` más un `Get` de verificación (×2). |

---

## Escenarios de fallo

| Escenario | Qué pasa | Resultado |
| --- | --- | --- |
| DynamoDB caído al crear | La transacción de MongoDB confirma; el intento inline falla dentro de su presupuesto. | `201`, evento `PENDING`; el worker lo publica cuando DynamoDB vuelve. |
| DynamoDB acepta conexiones pero no responde | El presupuesto inline vence y aborta el SDK. | `201` dentro del presupuesto; evento `PENDING`; recuperado después sin duplicados. |
| DynamoDB guardó el ítem pero se perdió el acuse | El intento queda sin evidencia y programa reintento. | El reintento choca con su propio ítem, verifica la identidad y marca `PUBLISHED`. Un solo ítem. |
| Falla la actualización del outbox tras guardar en DynamoDB | `unsettled`; el evento sigue `PENDING` con lease. | Al vencer el lease se reprocesa, se verifica y se marca `PUBLISHED`. |
| El proceso muere con un evento reclamado | El claim queda vigente hasta que vence `nextAttemptAt`. | Al reiniciar, el worker lo reclama de nuevo. |
| Inline y worker compiten por el mismo evento | Solo uno obtiene el claim atómico; el otro no encuentra el evento elegible. | Un solo intento activo; transiciones protegidas por `claimToken`. |
| Otro evento ocupa la misma llave | Colisión real de identidad. | `FAILED` con `AUDIT_KEY_COLLISION`; el ítem existente no se toca. |
| Tabla inexistente o credenciales inválidas | Error del SDK, clasificado como transitorio. | Reintentos con backoff hasta que se corrija la configuración; no se pierden eventos. |
| La transacción de MongoDB falla | No hay commit. | Error al cliente; no existe evento. |
| Commit incierto de MongoDB | Se busca la validación por su `_id`. | Si existe: `201` y publicación inline. Si no: `503`, o reintento acotado con `Idempotency-Key`. |
| Una operación de MongoDB nunca responde durante un ciclo | El ciclo no termina. | Se registra el bloqueo; la recuperación se detiene hasta reiniciar. Los eventos siguen a salvo en el outbox (riesgo residual M-3). |

Las pruebas de integración reproducen estos casos con MongoDB y DynamoDB Local reales, incluidas caídas simuladas con un proxy TCP (`test/integration/audit.int-spec.ts` y `audit-recovery.int-spec.ts`).

---

## Garantías y límites

**Garantías:**

- Ninguna validación confirmada queda sin evento en el outbox (misma transacción).
- Cada evento llega a DynamoDB **al menos una vez**, siempre que el worker pueda ejecutarse y DynamoDB vuelva a estar disponible.
- Reintentos, acuses perdidos y competencia entre publicadores no generan ítems duplicados.

**Límites asumidos:**

- No hay transacción distribuida ni visibilidad inmediata del evento en DynamoDB.
- Los leases usan el reloj del proceso; con varias instancias, el lease debe superar la diferencia entre relojes. No se probó con varias instancias del proceso.
- No hay retención ni TTL de eventos `PUBLISHED`.
- Los eventos `FAILED` requieren intervención manual; no hay herramienta de reproceso.
- El worker basado en `setInterval` asume un proceso de larga vida. En un despliegue serverless (por ejemplo AWS Lambda) se sustituiría por una ejecución programada o por un disparador sobre los cambios del outbox.

---

## Observabilidad

Los logs contienen solo identificadores de evento, contadores y nombres de error; nunca documentos, nombres ni claves.

| Log | Nivel | Significado |
| --- | --- | --- |
| `Audit event <id> attempt <n> failed (<code>); retrying in <ms> ms` | WARN | Error transitorio; reintento programado. |
| `Audit event <id> failed permanently: <code>` | ERROR | Evento en `FAILED`. |
| `Audit event <id> is stored but the outbox update failed (...)` | WARN | Ítem guardado; se conciliará. |
| `Inline audit publication of event <id> skipped: ...` | WARN | Sin tiempo restante; queda para el worker. |
| `Audit recovery cycle: claimed N, published N, ...` | LOG | Resumen de un ciclo con trabajo. |
| `Audit recovery cycle has been running for N s ...` | ERROR | Ciclo bloqueado. |

Consultas útiles en `mongosh` (ver el [README](../../README.md#inspeccionar-los-datos-locales-)):

```javascript
db.audit_outbox.countDocuments({ status: 'PENDING' })
db.audit_outbox.find({ status: 'FAILED' }, { eventId: 1, lastErrorCode: 1, failedAt: 1 })
db.audit_outbox.find({ attempts: { $gt: 3 } }).sort({ attempts: -1 })
```
