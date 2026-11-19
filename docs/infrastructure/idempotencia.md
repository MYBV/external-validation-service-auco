# Idempotencia: HTTP y Auditoría

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Dos idempotencias distintas](#dos-idempotencias-distintas)
2. [Idempotencia HTTP: uso desde el cliente](#idempotencia-http-uso-desde-el-cliente)
3. [Huella de la solicitud (fingerprint)](#huella-de-la-solicitud-fingerprint)
4. [Flujo del POST con clave](#flujo-del-post-con-clave)
5. [Concurrencia: el índice único parcial](#concurrencia-el-índice-único-parcial)
6. [Persistencia acotada y errores interpretados](#persistencia-acotada-y-errores-interpretados)
7. [POST sin clave](#post-sin-clave)
8. [`IDEMPOTENCY_HASH_SECRET`](#idempotency_hash_secret)
9. [Idempotencia de la auditoría](#idempotencia-de-la-auditoría)
10. [Consideraciones y mejoras](#consideraciones-y-mejoras)

---

## Dos idempotencias distintas

Ninguna la exige el enunciado de Auco; son una mejora propia (A-11, D-11).

| | Idempotencia HTTP | Idempotencia de auditoría |
| --- | --- | --- |
| Objetivo | Que un cliente repita un `POST` sin crear dos validaciones | Que los reintentos de publicación no dupliquen eventos en DynamoDB |
| ¿Obligatoria? | **Opcional** para el cliente: solo aplica con el header `Idempotency-Key` | **Siempre activa** |
| Mecanismo | Huella HMAC + índice único parcial en MongoDB | `eventId` estable + `PutItem` condicional + verificación de identidad |
| Archivos | `src/validations/services/validations.service.ts`, `src/validations/utils/request-fingerprint.util.ts` | `src/audit/services/audit-publisher.service.ts`, `src/audit/repositories/validation-audit.repository.ts` |

Las dos son independientes: la clave HTTP nunca se reutiliza como llave de auditoría, y el `requestId` del contexto **no** es una clave de idempotencia.

---

## Idempotencia HTTP: uso desde el cliente

```bash
curl -X POST http://localhost:3300/validations \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-country-code: CO" \
  -H "Idempotency-Key: order-2026-0001" \
  -d '{"name":"Persona de ejemplo","documentNumber":"TEST-123456"}'
```

| Situación | Respuesta |
| --- | --- |
| Primera vez con esa clave | `201 { data: { id } }` y se crea la validación |
| Misma clave y mismo contenido | `201` con el **mismo** `id`; no se consulta REST Countries ni se crea otro evento |
| Misma clave y contenido distinto | `409 Idempotency key reuse with different content` |
| Formato de clave inválido | `400 Validation failed` |
| No se pudo confirmar el resultado | `503 Unable to confirm the operation; retry with the same Idempotency-Key` |

Formato: 8 a 128 caracteres `[A-Za-z0-9_.:-]`. El alcance es **global** (hay una sola API key compartida). Las claves no expiran.

---

## Huella de la solicitud (fingerprint)

```typescript
export function computeRequestFingerprint(secret: string, input: IFingerprintInput): string {
  const canonical = JSON.stringify({
    v: 1,
    countryCode: input.countryCode.trim().toUpperCase(),
    name: input.name.trim().normalize('NFC'),
    documentNumber: input.documentNumber.trim(),
  });
  const digest = createHmac('sha256', secret).update(canonical).digest('hex');
  return `v1:${digest}`;
}
```

- Representa el **contenido lógico** de la solicitud: país, nombre y documento, en un orden fijo.
- Excluye la `Idempotency-Key`, el `requestId` y los headers de transporte.
- Se guarda en la validación como `requestFingerprint` junto con `idempotencyKey`. **No** se guarda el body.
- El prefijo `v1:` permite cambiar el algoritmo o la forma canónica en el futuro.
- Ni la clave ni la huella aparecen en las respuestas: el mapper de `GET` usa una lista blanca de campos.

---

## Flujo del POST con clave

```
1. Zod valida headers (incluido el formato de Idempotency-Key) y body
2. fingerprint = HMAC(IDEMPOTENCY_HASH_SECRET, contenido)
3. findByIdempotencyKey(key)                         ← ANTES del país y del proveedor
     ├─ existe y misma huella   → 201 con el id existente (fin)
     └─ existe y otra huella    → 409 (fin)
4. CountriesService.assertEnabled(país)
5. RestCountriesService.enrich(país)                 ← una sola vez
6. Generar validationId, eventId y fecha              ← una sola vez
7. Persistencia acotada (hasta 3 intentos, mismos documentos):
     transacción { validation con idempotencyKey + requestFingerprint, evento PENDING }
8. Publicación inline de la auditoría (mejor esfuerzo)
9. 201 { data: { id } }
```

La búsqueda temprana (paso 3) evita llamadas innecesarias al proveedor, pero **no** es lo que garantiza la unicidad: eso lo hace el índice (siguiente sección).

---

## Concurrencia: el índice único parcial

```typescript
{
  key: { idempotencyKey: 1 },
  name: 'idempotencyKey_unique',
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: 'string' } },
}
```

- **Único**: si dos solicitudes con la misma clave llegan a la vez, solo una transacción confirma; la otra recibe un E11000.
- **Parcial**: solo indexa validaciones con clave. Las validaciones sin clave nunca chocan entre sí.

Las pruebas de integración envían 10 solicitudes concurrentes iguales y comprueban que queda **una** validación y **un** evento (`test/integration/validations.int-spec.ts`).

---

## Persistencia acotada y errores interpretados

Con clave, `persistIdempotently()` hace hasta `MAX_PERSISTENCE_ATTEMPTS = 3` intentos con **los mismos documentos** y sin volver a llamar al proveedor. Solo interpreta cuatro situaciones; cualquier otro error se relanza sin cambios (y el filtro lo convierte en `500`):

| Error | Interpretación | Acción |
| --- | --- | --- |
| E11000 de `idempotencyKey_unique` | Otra solicitud ganó la clave | Leer al ganador (hasta 3 lecturas, esperas de 25 y 50 ms): misma huella → `201` con su `id`; huella distinta → `409` |
| Error transitorio (`TransientTransactionError`, `WriteConflict`) que sobrevivió a los reintentos del driver | Conflicto pasajero | Leer al ganador; si no aparece, reintentar |
| `UnknownTransactionCommitResult` | El commit **pudo** haberse aplicado | Buscar el propio `validationId`; si existe con la misma huella → `201` y publicación inline; si no, seguir como error transitorio |
| E11000 del propio `_id` | Un intento anterior con commit incierto sí se aplicó, después de la búsqueda, y el reintento chocó con su propio registro | Buscar por `validationId`; si existe con la misma huella → `201` y publicación inline; si no, se relanza |

Además, si el "ganador" de la clave resulta ser un intento anterior **de la misma solicitud** (mismo `_id`), la respuesta es la misma (`201` con ese `id`) y también se publica la auditoría inline, porque es una creación confirmada y no un replay de otra solicitud.

Si se agotan los intentos sin confirmar: `503 Unable to confirm the operation; retry with the same Idempotency-Key`. Repetir con la misma clave es seguro: el índice impide el duplicado.

---

## POST sin clave

- Cada `POST` es una creación nueva, con **un solo intento** de persistencia.
- Un error transitorio que sobrevive a los reintentos del driver se propaga (`500`).
- Ante `UnknownTransactionCommitResult` se busca el propio registro: si existe, `201`; si no, `503 Unable to confirm the operation`.
- No hay protección contra duplicados: si el cliente repite la solicitud tras un timeout o un `503`, puede crear otra validación. Es la razón para recomendar la clave en integraciones.

---

## `IDEMPOTENCY_HASH_SECRET`

| Aspecto | Detalle |
| --- | --- |
| Uso | Llave del HMAC-SHA256 de la huella. No se usa para nada más. |
| Obligatoriedad | Opcional en el esquema de entorno, pero `ValidationsService` la exige al construirse (`requireIdempotencyConfig`). Como `AppModule` carga `ValidationsModule`, **sin ella la aplicación no arranca**: `Validations require IDEMPOTENCY_HASH_SECRET to be set`. |
| Formato | Mínimo 32 caracteres; si es más corta, el arranque falla con un error de validación del entorno. |
| Independencia | Distinta de `API_KEY`. Sin valor por defecto; no se genera al arrancar. |
| Seguridad | Nunca se registra ni se devuelve. `.env` no se versiona. |

Generarla:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
IDEMPOTENCY_HASH_SECRET=<valor generado>
```

**Rotación:** no está soportada. Cambiar el secreto invalida las huellas guardadas: reenviar una clave antigua con el mismo contenido respondería `409` en lugar de `201`. Una estrategia futura podría verificar con el secreto anterior y el nuevo, apoyándose en el prefijo de versión.

**¿Por qué HMAC y no un SHA-256 simple?** La huella se calcula sobre datos predecibles (nombre y número de documento). Un hash simple se podría revertir probando documentos; con un secreto, no. Matiz: en la colección `validations` el nombre y el documento ya están en claro, así que hoy la protección adicional es limitada; cobra valor si la huella llega a logs o exportaciones, o si en el futuro se cifran esos campos.

---

## Idempotencia de la auditoría

Siempre activa, sin intervención del cliente:

1. `eventId` (UUID) se genera **una vez**, antes de la transacción, y se guarda en el outbox.
2. El ítem de DynamoDB se reconstruye en cada intento desde el outbox: `PK`, `SK` y contenido son idénticos.
3. `PutItem` con `attribute_not_exists(PK)`: un segundo intento no sobrescribe.
4. Si la condición falla, se lee el ítem existente y se compara la identidad completa (`eventId`, `validationId`, `eventType`, `countryCode`, `createdAt`, `schemaVersion`). Misma identidad → replay válido; distinta → colisión real (`FAILED`).

Detalle en [`auditoria-outbox.md`](./auditoria-outbox.md#publicación-de-un-evento) y [`dynamodb-arquitectura.md`](./dynamodb-arquitectura.md#escritura-idempotente).

---

## Consideraciones y mejoras

- **Las claves no expiran.** Una `Idempotency-Key` queda reservada para siempre. APIs públicas suelen expirarlas (por ejemplo, a las 24 h); se podría añadir con un TTL sobre un campo de fecha.
- **Alcance global.** Con autenticación por cliente, el alcance debería ser por cliente.
- **Sin rotación del secreto** (ver arriba).
- **Sin clave no hay deduplicación.** No se deduplica por nombre o documento: dos validaciones legítimas del mismo documento son posibles.
