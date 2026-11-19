# External Validation Service (AUCO)

Servicio backend en Node.js/NestJS para la prueba técnica de Auco.ai. Expone dos endpoints:

- `POST /validations`: recibe `name` y `documentNumber`, enriquece el registro con datos geográficos de **REST Countries v5**, lo guarda en **MongoDB** y devuelve su `id`.
- `GET /validations/:id`: devuelve el registro guardado.

Cada creación genera un evento de auditoría en **DynamoDB Local** con llave por documento y fecha (`PK = DOCUMENT#<país>#<documento>`, `SK = <fecha ISO UTC>#<eventId>`).

> **Alcance:** el enriquecimiento es solo geográfico (país, región, capitales, idiomas, monedas). **No verifica identidad, titularidad documental, residencia ni nacionalidad.** Todos los datos de este documento son ficticios.

## Contenido

1. [Tecnologías](#tecnologías)
2. [Requisitos previos](#requisitos-previos)
3. [Inicio rápido](#inicio-rápido)
4. [Variables de entorno](#variables-de-entorno)
5. [Uso de la API](#uso-de-la-api)
6. [Auditoría, outbox e idempotencia](#auditoría-outbox-e-idempotencia)
7. [Pruebas](#pruebas)
8. [REST Countries: clave real y smoke test](#rest-countries-clave-real-y-smoke-test)
9. [Arquitectura y estructura](#arquitectura-y-estructura)
10. [Solución de problemas](#solución-de-problemas)
11. [Limitaciones y mejoras futuras](#limitaciones-y-mejoras-futuras)
12. [Documentación adicional](#documentación-adicional)

## Tecnologías

| Área | Tecnología |
| --- | --- |
| Runtime | Node.js 24 (ESM nativo) |
| Framework | NestJS 12 (Express) |
| Lenguaje | TypeScript 6, modo estricto |
| Validación | Zod 4 (entorno, entradas y respuestas externas) |
| Base documental | MongoDB 8.3.17 (imagen Docker, replica set `rs0`), driver oficial `mongodb` 7 |
| Auditoría | DynamoDB Local 3.3.2 (imagen Docker), SDK AWS v3 |
| HTTP externo | `@nestjs/axios` + REST Countries v5 |
| API docs | `@nestjs/swagger` (Swagger UI en `/docs`) |
| Pruebas | Vitest 5, Supertest, `@nestjs/testing` |

## Requisitos previos

- **Node.js 24** y npm (el repositorio no declara `engines`; las pruebas se ejecutaron con Node 24.21).
- **Docker** con Docker Compose (MongoDB con replica set y DynamoDB Local).
- Puertos libres en el host: `27018` (MongoDB), `8001` (DynamoDB Local) y `3300` (la aplicación, configurable con `PORT`).
- *Opcional:* [AWS CLI](https://aws.amazon.com/cli/) para inspeccionar DynamoDB Local.
- *Opcional:* una API key propia de REST Countries (ver [la sección correspondiente](#rest-countries-clave-real-y-smoke-test)). Sin ella, el servicio arranca, pero `POST /validations` responde `502`.

## Inicio rápido

Los comandos de `npm` son idénticos en PowerShell y Bash; solo cambian la copia de archivos y `curl`.

```bash
# 1. Dependencias (usa package-lock.json)
npm ci

# 2. Variables de entorno
cp .env.example .env            # PowerShell: Copy-Item .env.example .env

# 3. Edite .env: genere API_KEY e IDEMPOTENCY_HASH_SECRET (ver "Variables de entorno")
#    y, si la tiene, REST_COUNTRIES_API_KEY.

# 4. MongoDB (replica set) y DynamoDB Local
docker compose up -d

# 5. Inicialización idempotente: verifica el replica set, crea índices y el seed
#    de países (CO, MX) y crea la tabla DynamoDB si falta. Es repetible.
npm run infra:init

# 6. Arranque
npm run start                   # o: npm run start:dev (watch)
```

> **Paso imprescindible:** sin `npm run infra:init` el catálogo `countries` está vacío y todo `POST /validations` devuelve `400 Unsupported country code`.

Compruebe que corre:

```bash
curl http://127.0.0.1:3300/health        # PowerShell: curl.exe http://127.0.0.1:3300/health
# {"data":{"status":"ok"}}
```

Swagger UI: <http://127.0.0.1:3300/docs> (requiere `SWAGGER_ENABLED=true`, valor de `.env.example`). Swagger solo documenta; la protección real la aplica `ApiKeyGuard`. Para probar desde Swagger, use el botón *Authorize* con su `API_KEY`.

Para una compilación de producción local: `npm run build && npm run start:prod`. Docker Compose solo levanta las bases de datos; el `Dockerfile` existe pero no forma parte del flujo documentado ni se ejecutó en esta entrega.

## Variables de entorno

`.env` **no se versiona** (`.gitignore`); `.env.example` solo contiene valores ficticios o marcadores.

Genere secretos locales (mismo comando en PowerShell y Bash):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

> Los marcadores `replace-with-...` de `.env.example` superan la longitud mínima y el servicio arrancaría con ellos. **Sustitúyalos siempre.**

### Credenciales locales ficticias (no son secretos)

| Variable | Valor de `.env.example` | Nota |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | `local` | Solo para DynamoDB Local. |
| `AWS_SECRET_ACCESS_KEY` | `local` | Solo para DynamoDB Local. |
| `AWS_REGION` | `us-east-1` | DynamoDB Local la exige, no usa AWS real. |
| `DYNAMODB_ENDPOINT` | `http://127.0.0.1:8001` | `infra:init` y las pruebas de integración **rechazan** endpoints no locales para no tocar una cuenta AWS real. |

### Credenciales reales o generadas por usted

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `API_KEY` | Sí | Protege `/validations`. Mínimo 32 caracteres, aleatoria. Se envía como `x-api-key`. |
| `IDEMPOTENCY_HASH_SECRET` | Sí | Secreto del HMAC de `Idempotency-Key` (mín. 32). Independiente de `API_KEY`; no lo cambie entre arranques. |
| `REST_COUNTRIES_API_KEY` | Sí para enriquecer | **Credencial real del proveedor** (distinta de `API_KEY`). Se envía como `Authorization: Bearer`. `rc_live_demo` solo devuelve una muestra fija y **no** sirve para validar. |

### Conexiones y ajustes

| Variable | Defecto / ejemplo | Descripción |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` o `test`. |
| `PORT` | `3300` en el ejemplo (3000 si falta) | Puerto HTTP. |
| `SWAGGER_ENABLED` | `false` si falta (`true` en el ejemplo) | `true` o `false`. |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout global de solicitud. |
| `MONGO_URI` | `mongodb://127.0.0.1:27018/?directConnection=true` | Obligatoria para el módulo Mongo. |
| `MONGO_DB_NAME` | `external_validation` | |
| `MONGO_TIMEOUT_MS` | `5000` | |
| `DYNAMODB_TABLE` | `validation_audit` | |
| `DYNAMODB_TIMEOUT_MS` | `2000` | |
| `REST_COUNTRIES_BASE_URL` | `https://api.restcountries.com/countries/v5` | |
| `HTTP_TIMEOUT_MS` | `5000` | Por solicitud al proveedor; manténgalo menor que `REQUEST_TIMEOUT_MS`. |
| `AUDIT_WORKER_ENABLED` | `true` | Worker de recuperación del outbox. |
| `AUDIT_WORKER_INTERVAL_MS` | `15000` | |
| `AUDIT_BATCH_SIZE` | `20` | 1–500. |
| `AUDIT_LEASE_MS` | `60000` | |
| `AUDIT_INLINE_TIMEOUT_MS` | `1500` | Presupuesto de la publicación inmediata tras el commit. |
| `AUDIT_BACKOFF_MAX_MS` | `300000` | |

Si una variable es inválida, la aplicación falla al iniciar con un mensaje que nombra la variable, nunca su valor. Las relaciones entre las variables `AUDIT_*` están comentadas en `.env.example`.

## Uso de la API

### Encabezados

| Encabezado | Endpoint | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `x-api-key` | `POST`, `GET` | Sí | Debe coincidir con `API_KEY`. Falta o error: `401`. |
| `x-country-code` | solo `POST` | Sí | ISO 3166-1 alfa-2 (`CO`, `MX`); se normaliza a mayúsculas y debe estar habilitado en el catálogo. |
| `Idempotency-Key` | solo `POST` | No | 8–128 caracteres `[A-Za-z0-9_.:-]`. Ver [idempotencia](#auditoría-outbox-e-idempotencia). |

Todas las respuestas incluyen `x-request-id`. Los éxitos se envuelven en `{ "data": ... }`.

### Crear una validación

Bash (Git Bash, Linux, macOS):

```bash
curl -i -X POST http://127.0.0.1:3300/validations \
  -H "x-api-key: $API_KEY" \
  -H "x-country-code: CO" \
  -H "Idempotency-Key: demo-key-0001" \
  -H "Content-Type: application/json" \
  -d '{"name":"Persona de ejemplo","documentNumber":"TEST-123456"}'
```

PowerShell (use `curl.exe`; `curl` es un alias de `Invoke-WebRequest`):

```powershell
$env:API_KEY = "<su API_KEY>"
curl.exe -i -X POST http://127.0.0.1:3300/validations `
  -H "x-api-key: $env:API_KEY" `
  -H "x-country-code: CO" `
  -H "Idempotency-Key: demo-key-0001" `
  -H "Content-Type: application/json" `
  -d '{\"name\":\"Persona de ejemplo\",\"documentNumber\":\"TEST-123456\"}'
```

Respuesta `201 Created`:

```json
{ "data": { "id": "6afe8bd896064c2060297d32" } }
```

El cuerpo solo acepta `name` (máx. 120) y `documentNumber` (máx. 64), ambos texto; cualquier otro campo se rechaza.

### Consultar por ID

```bash
curl http://127.0.0.1:3300/validations/6afe8bd896064c2060297d32 -H "x-api-key: $API_KEY"
```

Respuesta `200 OK` (forma real; los valores de `enrichment` provienen del proveedor):

```json
{
  "data": {
    "id": "6afe8bd896064c2060297d32",
    "name": "Persona de ejemplo",
    "documentNumber": "TEST-123456",
    "countryCode": "CO",
    "enrichment": {
      "source": "rest-countries",
      "code": "CO",
      "commonName": "...",
      "officialName": "...",
      "region": "...",
      "subregion": "...",
      "capitals": ["..."],
      "languages": ["..."],
      "currencies": [{ "code": "...", "name": "...", "symbol": "..." }],
      "enrichedAt": "2026-11-19T05:40:40.097Z"
    },
    "createdAt": "2026-11-19T05:40:40.097Z"
  }
}
```

### Errores

Todos comparten el formato `{ statusCode, error, message, path, timestamp, requestId }` (y `details` en `400` de validación, sin los valores recibidos). Nunca incluyen stack traces, credenciales ni datos personales.

| Código | Causa | Ejemplo de `message` |
| --- | --- | --- |
| `400` | Cuerpo/encabezado malformado, `id` inválido, país no soportado | `Validation failed`, `Unsupported country code` |
| `401` | `x-api-key` ausente o incorrecta | `Missing or invalid API key` |
| `404` | Validación inexistente | `Validation not found` |
| `409` | Misma `Idempotency-Key` con contenido distinto | `Idempotency key reuse with different content` |
| `502` | Fallo, respuesta inválida o credencial rechazada del proveedor | `Geographic enrichment unavailable` |
| `503` | Límite de tasa del proveedor (`429`) o persistencia idempotente no confirmable | |
| `504` | Timeout del proveedor | `Geographic enrichment unavailable` |

## Auditoría, outbox e idempotencia

1. `POST /validations` valida entradas, comprueba el país en el catálogo y consulta REST Countries (solo recibe el código de país; nunca nombre, documento ni claves del servicio).
2. Una **transacción MongoDB** guarda la validación y un evento de auditoría `PENDING` (outbox). El commit es el punto de confirmación: responde `201`.
3. Justo después se intenta publicar el evento en DynamoDB con un presupuesto de `AUDIT_INLINE_TIMEOUT_MS`. Si DynamoDB falla, **igualmente responde `201`** y el evento queda `PENDING`.
4. Un **worker** (al arrancar y cada `AUDIT_WORKER_INTERVAL_MS`) reclama eventos pendientes con *lease*, reintenta con *backoff* y los marca `PUBLISHED`. La escritura en DynamoDB es condicional (`PutItem` con condición de llave inexistente), por lo que reintentos o confirmaciones ambiguas no duplican eventos.

Por tanto, `201` **no** significa que el evento ya sea visible en DynamoDB: la garantía es entrega eventual *at-least-once* con efecto idempotente.

**Idempotencia HTTP (opcional):** con `Idempotency-Key`, repetir la misma solicitud devuelve el mismo `id` y `201` sin volver a consultar al proveedor; la misma clave con otro contenido devuelve `409`. Sin clave, cada `POST` crea una validación nueva.

### Comprobar la auditoría en DynamoDB Local

Requiere AWS CLI y credenciales **ficticias** (DynamoDB Local no las valida):

```bash
export AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_DEFAULT_REGION=us-east-1
aws dynamodb query --endpoint-url http://127.0.0.1:8001 --table-name validation_audit \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"DOCUMENT#CO#TEST-123456"}}'
```

```powershell
$env:AWS_ACCESS_KEY_ID = "local"; $env:AWS_SECRET_ACCESS_KEY = "local"; $env:AWS_DEFAULT_REGION = "us-east-1"
aws dynamodb query --endpoint-url http://127.0.0.1:8001 --table-name validation_audit `
  --key-condition-expression "PK = :pk" `
  --expression-attribute-values file://pk.json   # pk.json: {":pk":{"S":"DOCUMENT#CO#TEST-123456"}}
```

El resultado incluye `PK`, `SK` (`<fecha>#<eventId>`), `eventId`, `validationId`, `eventType` (`VALIDATION_CREATED`), `countryCode`, `createdAt` y `schemaVersion`. Si DynamoDB estuvo caído, espere un ciclo del worker (15 s por defecto).

> **Privacidad:** el número de documento forma parte de la `PK` (lo pide el enunciado). Los logs de la aplicación no lo registran. En producción se recomienda derivar la `PK` con HMAC y restringir el acceso a la tabla.

## Pruebas

| Comando | Qué ejecuta | Requiere Docker/`.env` |
| --- | --- | --- |
| `npm run test` | Unitarias (Vitest, dobles; sin red) | No |
| `npm run test:e2e` | HTTP con Supertest sobre `configureApp()` y dobles | No |
| `npm run test:integration` | MongoDB replica set y DynamoDB Local reales: transacciones, outbox, escritura condicional, recuperación con caída simulada de DynamoDB | **Sí** (`docker compose up -d` y `.env`) |
| `npm run test:cov` | Unitarias con cobertura | No |

Las pruebas de integración usan solo bases y tablas `ev_test_<uuid>` y las eliminan; nunca tocan `external_validation` ni `validation_audit`. **Ninguna prueba automatizada consume REST Countries real ni AWS real.**

Controles de calidad: `npm run typecheck`, `npm run lint:check`, `npm run format:check`, `npm run build`.

Resultados verificados en la Etapa 6 (19/11/2026, Node 24.21): ver [`docs/05-delivery.md`](./docs/05-delivery.md).

## REST Countries: clave real y smoke test

El cliente usa `GET https://api.restcountries.com/countries/v5/codes.alpha_2/{CODE}` con `Authorization: Bearer <clave>` y `response_fields`, valida `data.objects` con Zod y comprueba que `codes.alpha_2` coincida. Mapeo de fallos: `429` → `503`, timeout → `504`, cualquier otro fallo o respuesta inválida → `502`. Sin reintentos.

1. Cree una cuenta y una clave en <https://restcountries.com/sign-up> (plan gratuito: 1 000 solicitudes/mes y 20 cada 10 s; la cuenta puede deshabilitarse si los `4xx` superan el 15 % del límite).
2. Colóquela **solo** en su `.env` local (`REST_COUNTRIES_API_KEY=...`). No la suba a Git, issues ni capturas.
3. *(Opcional)* Ejecute el smoke test manual, que hace **una** solicitud (`CO`) y no imprime la clave:

```bash
npm run smoke:rest-countries
```

| Salida | Código | Significado |
| --- | --- | --- |
| `OK: HTTP 200, CO = "..."` | 0 | El contrato real coincide con el esquema Zod. |
| `FAILED: ...` | 1 | Fallo del proveedor, de red o del esquema. |
| `NOT EXECUTED: ...` | 2 | No hay clave legítima (vacía, marcador o `rc_live_demo`); la integración real sigue sin verificar. |

Con la clave configurada, repita el `POST` de ejemplo: la respuesta debe traer datos reales de Colombia en `enrichment`.

## Arquitectura y estructura

```text
Cliente → RequestContextMiddleware (AsyncLocalStorage) → ApiKeyGuard → Zod
        → ValidationsService → countries (catálogo Mongo) → REST Countries v5
        → transacción MongoDB { validation + outbox PENDING } → 201
        → publicación inmediata a DynamoDB (mejor esfuerzo) / AuditRecoveryWorker
```

```text
src/
  app.module.ts, app.setup.ts, main.ts   # bootstrap; configureApp() se reutiliza en e2e
  common/        # contexto de solicitud, guard API key, filtro de excepciones, interceptors
  config/        # esquema Zod del entorno y configuración tipada
  countries/     # catálogo y seed idempotente (CO, MX)
  enrichment/    # cliente REST Countries v5 y esquema Zod
  validations/   # controller, servicio, repositorio, mapper, idempotencia
  audit/         # outbox, publicador, worker de recuperación, repositorio DynamoDB
  database/      # módulos Mongo y Dynamo, y la inicialización de `infra:init`
  health/        # GET /health (público)
test/            # e2e (*.e2e-spec.ts) e integración (integration/*.int-spec.ts)
scripts/         # smoke test manual de REST Countries
docs/            # requisitos, arquitectura, plan, uso de IA y entrega
```

**Justificación de las llaves DynamoDB:** `PK = DOCUMENT#<país>#<documento>` agrupa el historial de un documento y evita mezclar el mismo número en países distintos; `SK = <ISO UTC>#<eventId>` ordena cronológicamente y desempata eventos del mismo milisegundo. Reintentos reescriben exactamente la misma llave, lo que habilita la escritura condicional idempotente. Detalle en [`docs/02-architecture.md`](./docs/02-architecture.md) §9.2.

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| `400 Unsupported country code` con `CO` | No se ejecutó `npm run infra:init` (catálogo vacío) o el país está deshabilitado. |
| `502 Geographic enrichment unavailable` | Falta o es inválida `REST_COUNTRIES_API_KEY`, o el proveedor no responde. Ver [smoke test](#rest-countries-clave-real-y-smoke-test). |
| `DYNAMODB_ENDPOINT must be set explicitly...` | Falta `.env` o el endpoint no es local (`localhost`, `127.0.0.1`, `[::1]`). |
| `infra:init` no conecta con MongoDB | Espere a que `docker compose ps` muestre `mongo` *healthy* (inicia el replica set). Use `directConnection=true` y el puerto `27018`. |
| Puerto ocupado | Cambie `PORT`, o los puertos publicados en `docker-compose.yml` (y las URLs del `.env`). |
| DynamoDB Local no persiste o falla el volumen | El contenedor corre como root para poder crear su SQLite en el volumen; revise `docker compose logs dynamodb-local`. |
| `201` pero el evento no aparece en DynamoDB | Es la ventana de consistencia eventual: espere el siguiente ciclo del worker (`AUDIT_WORKER_INTERVAL_MS`) y revise que `AUDIT_WORKER_ENABLED=true`. |
| La aplicación no arranca por entorno inválido | El mensaje lista las variables incorrectas (sin sus valores). |

Para apagar las bases sin borrar datos: `docker compose down`. Para borrarlas también (acción destructiva, solo local): `docker compose down -v`.

## Limitaciones y mejoras futuras

**Limitaciones conocidas**

- La integración con REST Countries real **no se ha verificado** por ausencia de una clave propia en la entrega; la cubren pruebas con respuestas simuladas del contrato v5.
- No hay endpoint para consultar el historial de auditoría; se inspecciona en DynamoDB (AWS CLI). No se pidió en el enunciado.
- Autenticación por una única API key compartida; sin usuarios, JWT ni multitenancy.
- El número de documento está en la `PK` y en MongoDB sin cifrar.
- No hay retención de eventos `PUBLISHED` ni reproceso manual de `FAILED`; los *leases* usan el reloj del proceso; no se probaron varias instancias de la aplicación.
- Una operación de MongoDB que nunca responda puede bloquear el ciclo del worker hasta reiniciar (el log lo advierte; ver `docs/02-architecture.md` §10.4).
- Mientras DynamoDB esté caído, cada `POST` puede tardar hasta `AUDIT_INLINE_TIMEOUT_MS` extra.
- Solo `CO` y `MX` en el seed; no se afirma en qué países opera Auco.

**Con más tiempo**

- Validar y documentar la integración real de REST Countries y un job manual en CI.
- `PK` derivada por HMAC y cifrado de campos sensibles.
- Endpoint de lectura del historial por documento y paginación.
- Healthcheck de readiness profundo y métricas del worker; `socketTimeoutMS` evaluado bajo carga.
- Autenticación por cliente con rotación de claves y rotación dual de `IDEMPOTENCY_HASH_SECRET`.
- Despliegue de la imagen Docker y DynamoDB/MongoDB gestionados, con pruebas multiinstancia.

## Documentación adicional

- [`docs/01-requirements.md`](./docs/01-requirements.md): enunciado original y requisitos.
- [`docs/02-architecture.md`](./docs/02-architecture.md): arquitectura y decisiones (D-01 a D-25).
- [`docs/03-development-plan.md`](./docs/03-development-plan.md): plan por etapas.
- [`docs/04-ai-usage.md`](./docs/04-ai-usage.md): registro del uso de IA.
- [`docs/05-delivery.md`](./docs/05-delivery.md): matriz de trazabilidad, checklist y borradores de entrega.
