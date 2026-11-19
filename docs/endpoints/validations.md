# Endpoints: Validations

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Resumen de Endpoints](#resumen-de-endpoints)
2. [Headers](#headers)
3. [POST /validations](#post-validations)
4. [GET /validations/:id](#get-validationsid)
5. [Contrato de error](#contrato-de-error)
6. [Archivos del módulo](#archivos-del-módulo)

---

## Resumen de Endpoints

| Método | URL | Descripción |
| --- | --- | --- |
| `POST` | `/validations` | Crea una validación enriquecida con datos geográficos, la guarda en MongoDB y registra su evento de auditoría |
| `GET` | `/validations/:id` | Devuelve una validación guardada |

**URL base local**: `http://localhost:3300` (valor de `PORT` en `.env.example`; por defecto `3000`). Sin prefijo ni versionado.

> **Alcance:** el enriquecimiento describe el país indicado; **no** verifica identidad, titularidad documental, residencia ni nacionalidad.

---

## Headers

| Header | `POST` | `GET` | Descripción |
| --- | --- | --- | --- |
| `x-api-key` | ✅ | ✅ | API key del servicio (`API_KEY`). Falta o no coincide → `401`. |
| `x-country-code` | ✅ | ❌ | ISO 3166-1 alfa-2 de un país habilitado (por ejemplo `CO`, `MX`). Se normaliza a mayúsculas. |
| `Idempotency-Key` | Opcional | ❌ | 8 a 128 caracteres `[A-Za-z0-9_.:-]`. Ver [`idempotencia.md`](../infrastructure/idempotencia.md). |
| `Content-Type` | `application/json` | — | |

Todas las respuestas, exitosas o no, incluyen el header **`x-request-id`** (ver [`request-context.md`](../infrastructure/request-context.md)).

---

## POST /validations

### Descripción General

Recibe un nombre y un número de documento, valida el país del header contra el catálogo local, consulta **REST Countries v5** para obtener una fotografía geográfica del país y guarda la validación en MongoDB. En la **misma transacción** guarda un evento de auditoría pendiente (outbox), que se publica en DynamoDB de inmediato si es posible o después mediante el worker de recuperación.

### Información del Endpoint

| Campo | Valor |
| --- | --- |
| **Nombre** | Create validation |
| **Método** | `POST` |
| **URL** | `/validations` |
| **Autenticación** | `x-api-key` |
| **x-country-code** | Requerido |
| **Respuesta exitosa** | `201 Created` |

### Request Body

Objeto estricto: un campo desconocido produce `400`.

| Campo | Tipo | Requerido | Reglas |
| --- | --- | --- | --- |
| `name` | `string` | ✅ | Se recorta; 1 a 120 caracteres; sin caracteres de control |
| `documentNumber` | `string` | ✅ | Se recorta; 1 a 64 caracteres; sin caracteres de control. Es texto, no número: se conserva su formato |

Los valores solo se recortan: no se alteran nombres ni formatos documentales legítimos, y no se infiere nada del número de documento.

### Ejemplo de Request

```bash
curl -i -X POST http://localhost:3300/validations \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-country-code: CO" \
  -H "Idempotency-Key: order-2026-0001" \
  -d '{"name":"Persona de ejemplo","documentNumber":"TEST-123456"}'
```

### Respuesta Exitosa

```
HTTP/1.1 201 Created
x-request-id: 3f0c5c7e-1d2b-4a8e-9c3f-2b1d0e9a7c55
```

```json
{
  "data": {
    "id": "6740f1c2a1b2c3d4e5f60718"
  }
}
```

El `201` se responde cuando la transacción de MongoDB (validación + evento de auditoría `PENDING`) **confirma**. No significa que el evento ya esté en DynamoDB: si DynamoDB no está disponible, la respuesta sigue siendo `201` y el evento se entrega después. Ver [`auditoria-outbox.md`](../infrastructure/auditoria-outbox.md).

### Flujo Interno

```
1. RequestContextMiddleware → ApiKeyGuard
2. Zod: headers (x-country-code, Idempotency-Key) y body
3. Con Idempotency-Key: búsqueda de replay  → 201 mismo id | 409
4. CountriesService.assertEnabled(país)    → 400 si no está habilitado
5. RestCountriesService.enrich(país)       → 502 / 503 / 504 si falla
6. Transacción MongoDB: validations + audit_outbox (PENDING)
7. Publicación inline en DynamoDB (mejor esfuerzo, nunca cambia la respuesta)
8. 201 { data: { id } }
```

### Idempotencia

| Situación | Respuesta |
| --- | --- |
| Sin `Idempotency-Key` | Cada `POST` crea una validación nueva |
| Misma clave y mismo contenido | `201` con el mismo `id`, sin volver a consultar el proveedor |
| Misma clave y contenido distinto | `409` |

### Errores

| Código | `message` | Causa |
| --- | --- | --- |
| `400` | `Validation failed` (+ `details`) | Body o headers inválidos, campo desconocido, `x-country-code` o `Idempotency-Key` con formato inválido |
| `400` | `Unsupported country code` | País desconocido o deshabilitado en el catálogo |
| `400` | `Bad Request` | JSON mal formado |
| `401` | `Missing or invalid API key` | `x-api-key` ausente o incorrecta |
| `409` | `Idempotency key reuse with different content` | Clave reutilizada con otro contenido |
| `502` | `Geographic enrichment unavailable` | Proveedor con `401`/`403`/`404`/`5xx`, error de red o respuesta inválida |
| `503` | `Geographic enrichment unavailable` | Límite de tasa del proveedor (`429`) |
| `503` | `Unable to confirm the operation; retry with the same Idempotency-Key` | Con clave: no se pudo confirmar la persistencia tras los intentos acotados. Repetir con la misma clave es seguro |
| `503` | `Unable to confirm the operation` | Sin clave: commit incierto y registro no encontrado |
| `504` | `Geographic enrichment unavailable` | Timeout del proveedor (`HTTP_TIMEOUT_MS`) |
| `504` | `Request timeout` | El request superó `REQUEST_TIMEOUT_MS` |
| `500` | `Internal server error` | Error no interpretado (por ejemplo, la transacción de MongoDB falló) |

Ejemplo de `400` por formato del país:

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

Los `details` nunca repiten los valores recibidos.

---

## GET /validations/:id

### Descripción General

Devuelve la validación guardada en MongoDB. No consulta REST Countries ni DynamoDB: el enriquecimiento devuelto es el que se guardó al crear el registro.

### Información del Endpoint

| Campo | Valor |
| --- | --- |
| **Nombre** | Find validation by id |
| **Método** | `GET` |
| **URL** | `/validations/:id` |
| **Autenticación** | `x-api-key` |
| **x-country-code** | No requerido |
| **Respuesta exitosa** | `200 OK` |

### Path Parameters

| Parámetro | Tipo | Requerido | Descripción |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | `id` devuelto por el `POST`: ObjectId de 24 caracteres hexadecimales |

### Ejemplo de Request

```bash
curl -i http://localhost:3300/validations/6740f1c2a1b2c3d4e5f60718 \
  -H "x-api-key: $API_KEY"
```

### Respuesta Exitosa

```json
{
  "data": {
    "id": "6740f1c2a1b2c3d4e5f60718",
    "name": "Persona de ejemplo",
    "documentNumber": "TEST-123456",
    "countryCode": "CO",
    "enrichment": {
      "source": "rest-countries",
      "code": "CO",
      "commonName": "Colombia",
      "officialName": "Republic of Colombia",
      "region": "Americas",
      "subregion": "South America",
      "capitals": ["Bogotá"],
      "languages": ["Spanish"],
      "currencies": [{ "code": "COP", "name": "Colombian peso", "symbol": "$" }],
      "enrichedAt": "2026-11-19T15:30:00.000Z"
    },
    "createdAt": "2026-11-19T15:30:00.000Z"
  }
}
```

Los valores de `enrichment` son ilustrativos: dependen de lo que devolvió REST Countries al crear el registro.

| Campo | Descripción |
| --- | --- |
| `id` | `_id` de MongoDB en texto |
| `name`, `documentNumber` | Tal como se recibieron (recortados) |
| `countryCode` | País validado contra el catálogo |
| `enrichment` | Fotografía geográfica (`ICountryEnrichment`). Ver [`enriquecimiento-rest-countries.md`](../infrastructure/enriquecimiento-rest-countries.md#datos-guardados-icountryenrichment) |
| `createdAt` | Fecha de creación (UTC); coincide con la fecha del evento de auditoría |

El mapper `toValidationResponse` usa una **lista blanca**: `idempotencyKey`, `requestFingerprint` y el estado del outbox nunca se devuelven.

### Errores

| Código | `message` | Causa |
| --- | --- | --- |
| `400` | `Validation failed` | `id` que no es un ObjectId de 24 caracteres hexadecimales |
| `401` | `Missing or invalid API key` | `x-api-key` ausente o incorrecta |
| `404` | `Validation not found` | No existe una validación con ese `id` |
| `504` | `Request timeout` | El request superó `REQUEST_TIMEOUT_MS` |
| `500` | `Internal server error` | Error no interpretado (por ejemplo, MongoDB no disponible) |

---

## Contrato de error

Todos los errores tienen la forma `{ statusCode, error, message, path, timestamp, requestId, details? }`, sin stack traces, valores recibidos ni credenciales. Ver [`pipeline-http.md`](../infrastructure/pipeline-http.md#allexceptionfilter-contrato-de-error).

---

## Archivos del módulo

```
src/validations/
├── validations.module.ts              # importa MongoModule, CountriesModule, EnrichmentModule, AuditModule
├── controllers/validations.controller.ts
├── services/validations.service.ts    # orquestación, transacción, idempotencia
├── repositories/validation.repository.ts
├── mappers/validation.mapper.ts       # lista blanca para GET
├── interfaces/validation.interface.ts
├── schemas/                           # body, headers, Idempotency-Key, id
├── swagger/validations.swagger.ts     # SWCONF_VALIDATIONS
├── utils/request-fingerprint.util.ts  # HMAC de la huella
└── idempotency-config.ts              # exige IDEMPOTENCY_HASH_SECRET
```

Pruebas: `src/validations/services/validations.service.spec.ts`, `src/validations/validations-support.spec.ts`, `test/validations.e2e-spec.ts`, `test/integration/validations.int-spec.ts`.
