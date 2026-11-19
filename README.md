# External Validation Service — Prueba Técnica Auco 🛡️

Este servicio backend registra **validaciones** a partir de un nombre y un número de documento, las **enriquece** con datos geográficos públicos del país indicado, las guarda en **MongoDB** y deja un **evento de auditoría** por cada creación en **DynamoDB Local**, con llave por documento y fecha.

> **Alcance:** el enriquecimiento es solo geográfico (país, región, capitales, idiomas, monedas). **No verifica identidad, titularidad documental, residencia ni nacionalidad.** Todos los datos de este documento son ficticios.

---

## Contenido

1. [Descripción General](#descripción-general-)
2. [Documentación Técnica](#documentación-técnica-)
3. [Pre-requisitos](#pre-requisitos-)
4. [Configuración](#configuración-)
5. [Variables de Entorno](#variables-de-entorno-)
6. [Construido con](#construido-con-)
7. [Ejecución Local](#ejecución-local-)
8. [Dockerizando](#dockerizando-)
9. [Documentación Swagger](#documentación-swagger-)
10. [Uso de la API](#uso-de-la-api-)
11. [Decisiones de Diseño](#decisiones-de-diseño-)
12. [Inspeccionar los datos locales](#inspeccionar-los-datos-locales-)
13. [Testing](#testing-)
14. [Linting y Formateo](#linting-y-formateo-)
15. [Troubleshooting](#troubleshooting-)
16. [Limitaciones y Mejoras Futuras](#limitaciones-y-mejoras-futuras-)
17. [Estructura del Servicio](#estructura-del-servicio-)
18. [Documentación Adicional](#documentación-adicional-)

---

## Descripción General 📋

El servicio responde a la prueba técnica de Auco.ai: un servicio en Node.js con dos endpoints, enriquecimiento mediante una API pública, persistencia en MongoDB y auditoría en DynamoDB Local.

### ¿Qué hace el servicio?

- Expone `POST /validations`, que recibe `name` y `documentNumber` y valida las entradas con **Zod**.
- Toma el país del header `x-country-code` y lo comprueba contra un catálogo local (`CO`, `MX`).
- Consulta **REST Countries v5** para obtener una fotografía geográfica del país. Al proveedor solo se envía el código del país, nunca datos personales.
- Guarda la validación en **MongoDB** y responde con su `id`.
- Registra un evento de auditoría en **DynamoDB** con `PK = DOCUMENT#<país>#<documento>` y `SK = <fecha ISO UTC>#<eventId>`, mediante un **outbox transaccional** que no pierde eventos aunque DynamoDB falle.
- Expone `GET /validations/:id`, que devuelve el registro guardado.
- Admite `Idempotency-Key` opcional para que un cliente pueda reintentar sin crear duplicados.
- Protege los endpoints con una API key (`x-api-key`) y ofrece `GET /health` público.

---

## Documentación Técnica 📚

La arquitectura completa (endpoints, pipeline HTTP, contexto por request, MongoDB, DynamoDB, outbox de auditoría, idempotencia, REST Countries, catálogo de países y guías de extensión) está documentada en [`docs/documentation-index.md`](./docs/documentation-index.md).

Este README se centra en lo operativo (cómo instalar, configurar, correr y probar el servicio) y en las decisiones de diseño que pide la prueba.

---

## Pre-requisitos 📋

_Necesitas tener instalado lo siguiente:_ ⚠️

- **Node.js 24** y **npm** (las pruebas se ejecutaron con Node 24.21; el repositorio no declara `engines`).
- **Docker** con **Docker Compose** (MongoDB con replica set y DynamoDB Local).
- Puertos libres: `27018` (MongoDB), `8001` (DynamoDB Local) y `3300` (la aplicación, configurable con `PORT`).
- _Opcional:_ [AWS CLI](https://aws.amazon.com/cli/) para inspeccionar DynamoDB Local.
- _Opcional:_ una API key propia de [REST Countries](https://restcountries.com/sign-up) para enriquecer con datos reales.

```bash
# Verificar instalación
node --version            # v24.x.x
npm --version
docker compose version
```

---

## Configuración 🧰

_Ejecuta los siguientes pasos en orden._ Los comandos de `npm` son iguales en PowerShell y Bash.

### 1. Clonar el repositorio

```bash
git clone https://github.com/MYBV/external-validation-service-auco.git
cd external-validation-service-auco
```

### 2. Instalar dependencias

```bash
npm ci
```

`npm ci` instala exactamente las versiones de `package-lock.json`. Si falla, borra `node_modules` y vuelve a ejecutarlo.

### 3. Configurar variables de entorno

```bash
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
```

Genera los secretos locales (mismo comando en PowerShell y Bash) y cópialos en `API_KEY` e `IDEMPOTENCY_HASH_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Si tienes una clave de REST Countries, colócala en `REST_COUNTRIES_API_KEY`.

> ⚠️ Los marcadores `replace-with-...` de `.env.example` superan la longitud mínima y el servicio arrancaría con ellos. **Sustitúyelos siempre.**

### 4. Levantar MongoDB y DynamoDB Local

```bash
docker compose up -d
docker compose ps               # espera a que "mongo" y "dynamodb-local" aparezcan como healthy
```

> 💡 Los pasos 4 y 5 corresponden al **modo 1** (bases en Docker y API en tu máquina). Si prefieres levantar todo en contenedores con un solo comando, ve a [Dockerizando](#dockerizando-).

### 5. Inicializar la infraestructura

```bash
npm run infra:init
```

Verifica el replica set, crea los índices de MongoDB, carga el catálogo de países (`CO`, `MX`) y crea la tabla de DynamoDB si falta. Es **idempotente**: se puede repetir sin duplicar ni borrar nada.

> ⚠️ **Paso imprescindible:** sin `infra:init` el catálogo está vacío y todo `POST /validations` responde `400 Unsupported country code`.

---

## Variables de Entorno 🔐

`.env` **no se versiona**. `.env.example` solo contiene valores ficticios o marcadores. Si una variable es inválida, el servicio no arranca y el mensaje nombra la variable, nunca su valor.

| Variable | Descripción | Ejemplo / por defecto |
| --- | --- | --- |
| **NODE_ENV** | Entorno de ejecución | `development`, `production`, `test` |
| **PORT** | Puerto HTTP | `3300` (por defecto `3000`) |
| **API_KEY** | **Obligatoria.** Protege `/validations`; se envía como `x-api-key`. Mínimo 32 caracteres | _secreto generado_ |
| **SWAGGER_ENABLED** | Swagger UI en `/docs` | `true` (por defecto `false`) |
| **REQUEST_TIMEOUT_MS** | Límite por request (`504`) | `15000` |
| | | |
| **MONGO_URI** | **Obligatoria.** Conexión a MongoDB | `mongodb://127.0.0.1:27018/?directConnection=true` |
| **MONGO_DB_NAME** | Base de datos | `external_validation` |
| **MONGO_TIMEOUT_MS** | Timeout de conexión y de commit | `5000` |
| | | |
| **DYNAMODB_ENDPOINT** | **Obligatoria fuera de producción.** Solo endpoints locales en `infra:init` y en las pruebas | `http://127.0.0.1:8001` |
| **DYNAMODB_TABLE** | Tabla de auditoría | `validation_audit` |
| **DYNAMODB_TIMEOUT_MS** | Timeout por solicitud del SDK | `2000` |
| **AWS_REGION** | Región (DynamoDB Local la exige) | `us-east-1` |
| **AWS_ACCESS_KEY_ID** | Credencial ficticia para DynamoDB Local | `local` |
| **AWS_SECRET_ACCESS_KEY** | Credencial ficticia para DynamoDB Local | `local` |
| | | |
| **REST_COUNTRIES_BASE_URL** | URL del proveedor | `https://api.restcountries.com/countries/v5` |
| **REST_COUNTRIES_API_KEY** | **Obligatoria.** Clave **propia** del proveedor (distinta de `API_KEY`); se envía como `Authorization: Bearer` | _clave de restcountries.com_ |
| **HTTP_TIMEOUT_MS** | Timeout de la llamada al proveedor; menor que `REQUEST_TIMEOUT_MS` | `5000` |
| | | |
| **IDEMPOTENCY_HASH_SECRET** | **Obligatoria.** Secreto del HMAC de `Idempotency-Key`. Mínimo 32 caracteres; no cambiarlo entre arranques | _secreto generado_ |
| | | |
| **AUDIT_WORKER_ENABLED** | Worker de recuperación de auditoría | `true` |
| **AUDIT_WORKER_INTERVAL_MS** | Intervalo entre ciclos del worker | `15000` |
| **AUDIT_BATCH_SIZE** | Eventos por ciclo (1–500) | `20` |
| **AUDIT_LEASE_MS** | Duración del lease de un evento reclamado | `60000` |
| **AUDIT_INLINE_TIMEOUT_MS** | Presupuesto de la publicación inmediata tras el commit | `1500` |
| **AUDIT_BACKOFF_MAX_MS** | Tope del backoff de reintentos | `300000` |

Notas:

- Si `REST_COUNTRIES_API_KEY` **falta**, el servicio no arranca. Con el marcador de `.env.example` arranca, pero el proveedor rechaza la clave y el `POST` responde `502`. La clave demo `rc_live_demo` devuelve siempre una muestra fija y **no** sirve para validar.
- Las relaciones entre las variables `AUDIT_*` se validan al arrancar y están comentadas en `.env.example`. Detalle de cada variable en [`docs/infrastructure/configuracion-arranque.md`](./docs/infrastructure/configuracion-arranque.md#variables-de-entorno).

---

## Construido con 🔨

El proyecto fue desarrollado en Windows 11, pero es compatible con Linux y macOS.

- **[Node.js](https://nodejs.org)** — Entorno de ejecución (v24, ESM nativo)
- **[NestJS](https://docs.nestjs.com/)** — Framework (v12, adaptador Express)
- **[TypeScript](https://www.typescriptlang.org/)** — Lenguaje (v6, modo estricto)
- **[Zod](https://zod.dev/)** — Validación de entorno, entradas y respuestas externas (v4)
- **[MongoDB](https://www.mongodb.com/)** — Base documental (8.3.17 en Docker, replica set `rs0`) con el driver oficial `mongodb` (v7), sin Mongoose
- **[DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)** — Auditoría (3.3.2 en Docker) con el **SDK AWS v3**
- **[@nestjs/axios](https://www.npmjs.com/package/@nestjs/axios)** — Cliente HTTP para REST Countries (v12)
- **[REST Countries v5](https://restcountries.com/)** — API pública de enriquecimiento geográfico
- **[Swagger](https://swagger.io/)** — Documentación de la API (`@nestjs/swagger` v12)
- **[Vitest](https://vitest.dev/)** — Pruebas unitarias, e2e e integración (v5), con **Supertest** y `@nestjs/testing`

---

## Ejecución Local 🚀

### Modo desarrollo (con hot-reload)

```bash
npm run start:dev
```

El servicio queda disponible en: `http://localhost:3300` (sin prefijo ni versión).

### Modo normal y producción

```bash
npm run start                       # sin watch

npm run build && npm run start:prod # compilado
```

### Comprobar que corre

```bash
curl http://127.0.0.1:3300/health        # PowerShell: curl.exe http://127.0.0.1:3300/health
# {"data":{"status":"ok"}}
```

### Logs

Se imprimen en consola. Contienen identificadores, códigos de error y duraciones; **nunca** nombres, números de documento ni claves. Cada respuesta incluye el header `x-request-id` para correlacionarla con los logs.

---

## Dockerizando 🐋

`docker-compose.yml` ofrece **dos modos** con un único archivo, usando *perfiles* de Docker Compose. Ambos usan los mismos volúmenes, así que comparten los datos.

| Servicio | Perfil | Imagen | Puerto | Función |
| --- | --- | --- | --- | --- |
| `mongo` | _(siempre)_ | `mongo:8.3.17` | `127.0.0.1:27018` | Replica set `rs0` de un nodo, iniciado por el healthcheck |
| `dynamodb-local` | _(siempre)_ | `amazon/dynamodb-local:3.3.2` | `127.0.0.1:8001` | Auditoría; datos persistentes en un volumen |
| `infra-init` | `app` | `Dockerfile` (etapa `builder`) | — | Tarea única: verifica el replica set, crea índices, seed de países y tabla DynamoDB |
| `api` | `app` | `Dockerfile` (etapa `runtime`) | `127.0.0.1:3300` | La API; arranca solo si `infra-init` terminó bien |

### Modo 1 — Bases en Docker, API en tu máquina

Ideal para desarrollar (hot-reload, depuración):

```bash
docker compose up -d          # solo mongo y dynamodb-local
npm run infra:init
npm run start:dev             # o npm run start
```

### Modo 2 — Todo en contenedores

Ideal para evaluar el servicio sin instalar nada más que Docker. Requiere el archivo `.env` (paso 3 de [Configuración](#configuración-)):

```bash
docker compose --profile app up -d --build
docker compose --profile app ps      # infra-init debe terminar "exited (0)" y api quedar "running"
docker compose --profile app logs -f api
```

La API queda en `http://localhost:3300`, igual que en el modo 1.

En este modo, Compose **sobrescribe** las variables de conexión del `.env` para usar la red interna de Docker: `MONGO_URI` (`mongodb://mongo:27017/?directConnection=true`), `DYNAMODB_ENDPOINT` (`http://dynamodb-local:8000`), las credenciales ficticias de AWS y `PORT=3300`. El resto (`API_KEY`, `REST_COUNTRIES_API_KEY`, `IDEMPOTENCY_HASH_SECRET`, `SWAGGER_ENABLED`, `AUDIT_*`...) se toma de tu `.env`. El `.env` nunca se copia dentro de la imagen.

> ⚠️ No ejecutes los dos modos a la vez: la API del host y la del contenedor usan el puerto `3300`.

### Detener y limpiar

```bash
docker compose --profile app down      # detiene todo (ambos modos), sin borrar datos
docker compose --profile app down -v   # detiene todo y BORRA los datos (solo local)
```

Tras cambiar código, en el modo 2 vuelve a construir con `docker compose --profile app up -d --build`.

---

## Documentación Swagger 📖

Con `SWAGGER_ENABLED=true` (valor de `.env.example`), la documentación interactiva está en:

```
http://localhost:3300/docs
```

Usa el botón **Authorize** con tu `API_KEY` para probar los endpoints. Swagger solo **documenta** la seguridad; quien **protege** las rutas es `ApiKeyGuard`.

---

## Uso de la API 📡

| Método | Ruta | Autenticación | Descripción |
| --- | --- | --- | --- |
| `POST` | `/validations` | `x-api-key` | Crea una validación enriquecida → `201 { data: { id } }` |
| `GET` | `/validations/:id` | `x-api-key` | Devuelve la validación guardada |
| `GET` | `/health` | Pública | Liveness básico |

### Headers

| Header | Endpoint | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `x-api-key` | `POST`, `GET` | Sí | Debe coincidir con `API_KEY`. Falta o error: `401` |
| `x-country-code` | solo `POST` | Sí | ISO 3166-1 alfa-2 (`CO`, `MX`); debe estar habilitado en el catálogo |
| `Idempotency-Key` | solo `POST` | No | 8–128 caracteres `[A-Za-z0-9_.:-]` |

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

PowerShell (usa `curl.exe`; `curl` es un alias de `Invoke-WebRequest`):

```powershell
$env:API_KEY = "<tu API_KEY>"
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

El body solo acepta `name` (máx. 120) y `documentNumber` (máx. 64), ambos texto; cualquier otro campo se rechaza.

### Consultar por ID

```bash
curl http://127.0.0.1:3300/validations/6afe8bd896064c2060297d32 -H "x-api-key: $API_KEY"
```

Respuesta `200 OK` (los valores de `enrichment` provienen del proveedor):

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

Todos comparten el formato `{ statusCode, error, message, path, timestamp, requestId }` (más `details` en los `400` de validación, sin los valores recibidos). Nunca incluyen stack traces, credenciales ni datos personales.

| Código | Causa | `message` |
| --- | --- | --- |
| `400` | Body o header malformado, `id` inválido | `Validation failed` |
| `400` | País desconocido o deshabilitado | `Unsupported country code` |
| `401` | `x-api-key` ausente o incorrecta | `Missing or invalid API key` |
| `404` | Validación inexistente | `Validation not found` |
| `409` | Misma `Idempotency-Key` con contenido distinto | `Idempotency key reuse with different content` |
| `502` | Fallo, respuesta inválida o credencial rechazada del proveedor | `Geographic enrichment unavailable` |
| `503` | Límite de tasa del proveedor (`429`) | `Geographic enrichment unavailable` |
| `503` | Persistencia no confirmable | `Unable to confirm the operation; retry with the same Idempotency-Key` |
| `504` | Timeout del proveedor / del request | `Geographic enrichment unavailable` / `Request timeout` |

Referencia completa: [`docs/endpoints/validations.md`](./docs/endpoints/validations.md).

---

## Decisiones de Diseño 🧭

### Auditoría con outbox transaccional

1. `POST /validations` valida las entradas, comprueba el país en el catálogo y consulta REST Countries.
2. Una **transacción de MongoDB** guarda la validación y un evento de auditoría `PENDING` (outbox). El commit es el punto de confirmación: responde `201`.
3. Justo después se intenta publicar el evento en DynamoDB con un presupuesto de `AUDIT_INLINE_TIMEOUT_MS`. Si DynamoDB falla, **igualmente responde `201`** y el evento queda `PENDING`.
4. Un **worker** (al arrancar y cada `AUDIT_WORKER_INTERVAL_MS`) reclama los eventos pendientes con *lease*, reintenta con *backoff* y los marca `PUBLISHED`. La escritura en DynamoDB es condicional, así que reintentos o confirmaciones ambiguas no duplican eventos.

Por tanto, `201` **no** significa que el evento ya sea visible en DynamoDB: la garantía es entrega eventual *at-least-once* con efecto idempotente.

### Por qué `201` tras el commit de MongoDB

El enunciado no define qué hacer si la validación se guarda en MongoDB pero falla la auditoría en DynamoDB. Esta política es una **decisión propia** (D-10, detalle en [`docs/infrastructure/auditoria-outbox.md`](./docs/infrastructure/auditoria-outbox.md)):

- **Por qué no `503`:** diría que la creación falló cuando la validación ya existe, y empujaría al cliente a reintentar. Sin `Idempotency-Key`, ese reintento crearía un registro duplicado.
- **Por qué no `202 Accepted`:** `202` indica que la solicitud se aceptó para procesarla después, pero el recurso ya está creado y se puede consultar con `GET /validations/:id`.
- **Por qué no escribir en DynamoDB dentro de la misma operación:** no existe una transacción que abarque MongoDB y DynamoDB. Con escrituras independientes, cualquiera de las dos puede fallar después de la otra. El outbox convierte ese hueco en una entrega eventual que no pierde eventos.

Si el commit de MongoDB falla, la creación sí falla y no se responde `201`.

### Por qué esas llaves en DynamoDB

```text
PK = DOCUMENT#<país>#<documento>
SK = <fecha ISO UTC>#<eventId>
```

- **Partición por documento:** el enunciado pide una llave por documento y fecha. Con el documento en la `PK`, todo su historial se lee con un `Query` eficiente, sin escaneos.
- **País en la partición:** el mismo número puede existir en países distintos y sus historiales no deben mezclarse.
- **Fecha en la `SK`:** la fecha ISO UTC tiene ancho fijo, así que el orden lexicográfico coincide con el cronológico.
- **`eventId` en la `SK`:** desempata eventos del mismo milisegundo y hace que cada reintento escriba **exactamente** la misma llave. Con un `PutItem` condicional, la escritura es idempotente; si la llave ya existe, se compara la identidad completa del evento antes de aceptarlo como replay.

Compromiso conocido: el documento queda dentro de la `PK`; en producción se derivaría con un HMAC. Detalle en [`docs/infrastructure/dynamodb-arquitectura.md`](./docs/infrastructure/dynamodb-arquitectura.md#diseño-de-llaves-por-qué-pk-y-sk).

### Idempotencia HTTP (opcional)

Con `Idempotency-Key`, repetir la misma solicitud devuelve el mismo `id` y `201` sin volver a consultar al proveedor; la misma clave con otro contenido devuelve `409`. Sin clave, cada `POST` crea una validación nueva. Detalle en [`docs/infrastructure/idempotencia.md`](./docs/infrastructure/idempotencia.md).

---

## Inspeccionar los datos locales 🔍

### MongoDB

Abre una consola `mongosh` dentro del contenedor y selecciona la base de datos (por defecto `external_validation`; si cambiaste `MONGO_DB_NAME`, usa ese nombre):

```bash
docker compose exec mongo mongosh
```

```javascript
show databases
use external_validation
show collections
```

`show collections` lista tres colecciones:

| Colección | Contenido |
| --- | --- |
| `countries` | Catálogo de países permitidos (seed `CO` y `MX`): `code` (ISO alfa-2), `name`, `enabled`, `createdAt`, `updatedAt`. |
| `validations` | Una entrada por validación creada: `_id` (el `id` de la API), `name`, `documentNumber`, `countryCode`, `enrichment` (nombres, región, subregión, capitales, idiomas, monedas, `enrichedAt`), `createdAt` y, solo si se envió `Idempotency-Key`, `idempotencyKey` y `requestFingerprint` (HMAC, nunca el body). |
| `audit_outbox` | Un evento de auditoría por validación: `eventId`, `validationId`, `eventType` (`VALIDATION_CREATED`), `documentNumber`, `countryCode`, `occurredAt`, `status` (`PENDING`, `PUBLISHED` o `FAILED`), `attempts`, `nextAttemptAt` y, según el caso, `publishedAt`, `lastErrorCode`, `lastErrorAt`, `failedAt`. |

Consultas útiles dentro de `mongosh`:

```javascript
db.countries.find()
db.validations.find().sort({ createdAt: -1 }).limit(5)
db.audit_outbox.find({ status: 'PENDING' })
db.audit_outbox.countDocuments({ status: 'PUBLISHED' })
```

Las bases `ev_test_<uuid>` que puedas ver con `show databases` las crean las pruebas de integración y las eliminan al terminar.

### DynamoDB Local

Requiere AWS CLI y credenciales **ficticias** (DynamoDB Local no las valida):

```bash
export AWS_ACCESS_KEY_ID="local"
export AWS_SECRET_ACCESS_KEY="local"
export AWS_DEFAULT_REGION="us-east-1"
```

```powershell
$env:AWS_ACCESS_KEY_ID = "local"; $env:AWS_SECRET_ACCESS_KEY = "local"; $env:AWS_DEFAULT_REGION = "us-east-1"
```

**Tablas disponibles.** Solo debe aparecer `validation_audit` (más tablas `ev_test_*` si hay pruebas de integración en curso):

```bash
aws dynamodb list-tables \
  --endpoint-url http://localhost:8001 \
  --region us-east-1
```

**Todos los eventos** (`scan`; adecuado solo en local, con pocos datos):

```bash
aws dynamodb scan \
  --table-name validation_audit \
  --endpoint-url http://localhost:8001 \
  --region us-east-1
```

**Eventos de un documento**, con PartiQL o con `query` (ambos leen solo la partición del documento, en orden cronológico por `SK`):

```bash
aws dynamodb execute-statement \
  --statement "SELECT * FROM \"validation_audit\" WHERE PK = 'DOCUMENT#CO#TEST-123456'" \
  --endpoint-url http://localhost:8001 \
  --region us-east-1

aws dynamodb query \
  --table-name validation_audit \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"DOCUMENT#CO#TEST-123456"}}' \
  --endpoint-url http://localhost:8001 \
  --region us-east-1
```

En PowerShell, las comillas anidadas se pasan mal a programas externos; usa archivos JSON:

```powershell
# statement.json: {"Statement": "SELECT * FROM \"validation_audit\" WHERE PK = 'DOCUMENT#CO#TEST-123456'"}
aws dynamodb execute-statement --cli-input-json file://statement.json `
  --endpoint-url http://localhost:8001 --region us-east-1

# pk.json: {":pk":{"S":"DOCUMENT#CO#TEST-123456"}}
aws dynamodb query --table-name validation_audit `
  --key-condition-expression "PK = :pk" `
  --expression-attribute-values file://pk.json `
  --endpoint-url http://localhost:8001 --region us-east-1
```

La `PK` tiene la forma exacta `DOCUMENT#<país>#<documento>`, sin espacios: un espacio o una diferencia de mayúsculas en el documento no encuentra el evento. Cada ítem incluye `PK`, `SK` (`<fecha>#<eventId>`), `eventId`, `validationId`, `eventType` (`VALIDATION_CREATED`), `countryCode`, `createdAt` y `schemaVersion`. Si DynamoDB estuvo caído, espera un ciclo del worker (15 s por defecto).

> **Privacidad:** el número de documento forma parte de la `PK` (lo pide el enunciado). Los logs de la aplicación no lo registran. En producción se recomienda derivar la `PK` con HMAC y restringir el acceso a la tabla.

---

## Testing 🧪

Las pruebas corren con **[Vitest](https://vitest.dev/)**. **Ninguna prueba automatizada consume REST Countries real ni AWS real.**

| Comando | Qué ejecuta | Requiere Docker / `.env` |
| --- | --- | --- |
| `npm run test` | Unitarias (`src/**/*.spec.ts`, con dobles; sin red) | No |
| `npm run test:watch` | Unitarias en modo watch | No |
| `npm run test:cov` | Unitarias con cobertura | No |
| `npm run test:e2e` | HTTP con Supertest sobre el mismo `configureApp()` de `main.ts` (`test/*.e2e-spec.ts`) | No |
| `npm run test:integration` | Contra MongoDB (replica set) y DynamoDB Local reales: transacciones, outbox, escritura condicional, concurrencia y recuperación con caída simulada de DynamoDB (`test/integration/*.int-spec.ts`) | **Sí** |

**Aislamiento:** las pruebas de integración crean bases y tablas `ev_test_<uuid>` y solo borran recursos con ese prefijo; nunca tocan `external_validation` ni `validation_audit`. Además se niegan a usar un endpoint de DynamoDB que no sea local.

Resultados verificados: ver [`docs/development-stages/05-delivery.md`](./docs/development-stages/05-delivery.md).

### Smoke test con REST Countries real

El cliente usa `GET https://api.restcountries.com/countries/v5/codes.alpha_2/{CODE}` con `Authorization: Bearer <clave>`, valida la respuesta con Zod y traduce los fallos: `429` → `503`, timeout → `504`, cualquier otro fallo o respuesta inválida → `502`. Sin reintentos.

1. Crea una cuenta y una clave en <https://restcountries.com/sign-up> (plan gratuito: 1 000 solicitudes/mes y 20 cada 10 s; la cuenta puede deshabilitarse si los `4xx` superan el 15 % del límite).
2. Colócala **solo** en tu `.env` local (`REST_COUNTRIES_API_KEY=...`). No la subas a Git, issues ni capturas.
3. Ejecuta el smoke test, que hace **una** solicitud (`CO`) y no imprime la clave:

```bash
npm run smoke:rest-countries
```

| Salida | Código | Significado |
| --- | --- | --- |
| `OK: HTTP 200, CO = "..."` | 0 | El contrato real coincide con el esquema Zod |
| `FAILED: ...` | 1 | Fallo del proveedor, de red o del esquema |
| `NOT EXECUTED: ...` | 2 | No hay una clave legítima (vacía, marcador o `rc_live_demo`) |

---

## Linting y Formateo 🎨

### Verificar (no modifican archivos)

```bash
npm run typecheck
npm run lint:check
npm run format:check
npm run build
```

### Corregir

```bash
npm run lint      # ESLint con --fix
npm run format    # Prettier
```

---

## Troubleshooting 🔧

### Error: `400 Unsupported country code` con `CO`

**Solución:** ejecuta `npm run infra:init` (el catálogo de países está vacío) o revisa que el país esté habilitado en la colección `countries`.

### Error: `502 Geographic enrichment unavailable`

**Solución:** `REST_COUNTRIES_API_KEY` es un marcador o una clave inválida, o el proveedor no responde. Verifícalo con `npm run smoke:rest-countries`.

### Error: `REST Countries enrichment requires REST_COUNTRIES_API_KEY to be set` (o `IDEMPOTENCY_HASH_SECRET`, `MONGO_URI`)

**Solución:** falta la variable en `.env`. Todas son obligatorias para arrancar el servicio.

### Error: `DYNAMODB_ENDPOINT must be set explicitly...`

**Solución:** falta `.env` o el endpoint no es local (`localhost`, `127.0.0.1`, `[::1]` o `dynamodb-local`, el nombre del servicio dentro de Docker Compose). `infra:init` y las pruebas de integración solo aceptan DynamoDB Local.

### Error: `infra:init` no conecta con MongoDB o dice que no es un replica set

**Solución:** espera a que `docker compose ps` muestre `mongo` como *healthy* (el healthcheck inicia el replica set). Usa `directConnection=true` y el puerto `27018`.

### Error: `Invalid environment configuration`

**Solución:** el mensaje lista las variables incorrectas (sin sus valores). Revisa formatos y longitudes mínimas (`API_KEY` e `IDEMPOTENCY_HASH_SECRET`: 32 caracteres).

### Puerto ocupado

**Solución:** comprueba que no estés ejecutando los dos modos a la vez (API en el host y en el contenedor usan `3300`). Si el puerto lo usa otro programa, cambia `PORT` (modo 1) o los puertos publicados en `docker-compose.yml` (y las URLs del `.env`).

### Modo 2: `api` no arranca

**Solución:** `api` espera a que `infra-init` termine con éxito. Revisa `docker compose --profile app logs infra-init`: lo habitual es que falte `.env` o alguna variable obligatoria (`API_KEY`, `REST_COUNTRIES_API_KEY`, `IDEMPOTENCY_HASH_SECRET`). Corrige y vuelve a ejecutar `docker compose --profile app up -d --build`.

### DynamoDB Local no persiste o falla el volumen

**Solución:** el contenedor corre como root para poder crear su archivo SQLite en el volumen; revisa `docker compose logs dynamodb-local`.

### `201` pero el evento no aparece en DynamoDB

**Solución:** es la ventana de consistencia eventual. Espera el siguiente ciclo del worker (`AUDIT_WORKER_INTERVAL_MS`), confirma que `AUDIT_WORKER_ENABLED=true` y revisa el evento en `audit_outbox` (`status`, `attempts`, `lastErrorCode`).

---

## Limitaciones y Mejoras Futuras 🔭

### Limitaciones conocidas

- La integración con REST Countries real **no se ha verificado** en la entrega; la cubren pruebas con respuestas simuladas del contrato v5 y el smoke test manual.
- No hay endpoint para consultar el historial de auditoría; se inspecciona en DynamoDB con AWS CLI. No lo pide el enunciado.
- Autenticación con una única API key compartida; sin usuarios, JWT ni multitenancy.
- El número de documento está en la `PK` y en MongoDB sin cifrar.
- No hay retención de eventos `PUBLISHED` ni reproceso manual de `FAILED`; los *leases* usan el reloj del proceso; no se probaron varias instancias de la aplicación.
- Una operación de MongoDB que nunca responda puede bloquear el ciclo del worker hasta reiniciar (el log lo advierte; ver [`docs/infrastructure/auditoria-outbox.md`](./docs/infrastructure/auditoria-outbox.md#worker-de-recuperación)).
- Mientras DynamoDB esté caído, cada `POST` puede tardar hasta `AUDIT_INLINE_TIMEOUT_MS` adicionales.
- Solo `CO` y `MX` en el seed; no se afirma en qué países opera Auco.

### Con más tiempo

- Validar la integración real de REST Countries y automatizar un chequeo manual en CI.
- `PK` derivada por HMAC y cifrado de campos sensibles.
- Endpoint de lectura del historial por documento, con paginación.
- *Readiness* profundo y métricas del worker; evaluar `socketTimeoutMS` bajo carga.
- Autenticación por cliente con rotación de claves, rotación dual de `IDEMPOTENCY_HASH_SECRET` y expiración de las `Idempotency-Key`.
- Despliegue en la nube con bases gestionadas y pruebas con varias instancias; en un entorno serverless, sustituir el worker por una ejecución programada o un disparador sobre el outbox.

---

## Estructura del Servicio 📁

<details>
  <summary><strong>Ver estructura de carpetas</strong></summary>

```text
external-validation-service-auco/
├── src/
│   ├── main.ts, app.module.ts, app.setup.ts   # bootstrap; configureApp() se reutiliza en e2e
│   ├── swagger-conf.ts                        # metadata general de Swagger
│   ├── common/        # contexto por request, guard API key, pipes, interceptors, filtro
│   ├── config/        # esquema Zod del entorno y configuración tipada
│   ├── database/      # MongoModule, DynamoModule e infra:init
│   ├── countries/     # catálogo y seed idempotente (CO, MX)
│   ├── enrichment/    # cliente REST Countries v5 y esquema Zod
│   ├── validations/   # controller, servicio, repositorio, mapper, idempotencia
│   ├── audit/         # outbox, publicador, worker de recuperación, repositorio DynamoDB
│   └── health/        # GET /health (público)
├── test/              # e2e (*.e2e-spec.ts) e integración (integration/*.int-spec.ts)
├── scripts/           # smoke test manual de REST Countries
├── docs/              # documentación técnica (índice) y etapas de desarrollo
├── docker-compose.yml # MongoDB y DynamoDB Local; con --profile app, también infra-init y la API
├── Dockerfile         # imagen multi-etapa de la aplicación (Node 24)
└── .env.example       # plantilla de variables de entorno
```

</details>

<details>
  <summary><strong>Ver flujo de un POST /validations</strong></summary>

```text
Cliente → RequestContextMiddleware (AsyncLocalStorage, x-request-id) → ApiKeyGuard → Zod
        → ValidationsService → catálogo countries (MongoDB) → REST Countries v5
        → transacción MongoDB { validation + evento outbox PENDING } → 201
        → publicación inmediata en DynamoDB (mejor esfuerzo) / AuditRecoveryWorker
```

</details>

---

## Documentación Adicional 📚

- **Índice de la documentación técnica**: [`docs/documentation-index.md`](./docs/documentation-index.md)
- **Endpoints**: [`docs/endpoints/validations.md`](./docs/endpoints/validations.md) · [`docs/endpoints/health.md`](./docs/endpoints/health.md)
- **Guía para agregar un endpoint**: [`docs/guides/how-to-add-endpoint.md`](./docs/guides/how-to-add-endpoint.md)
- **Etapas de desarrollo** (requisitos, decisiones D-01 a D-25, plan, uso de IA y entrega):
  - [`docs/development-stages/01-requirements.md`](./docs/development-stages/01-requirements.md)
  - [`docs/development-stages/02-architecture.md`](./docs/development-stages/02-architecture.md)
  - [`docs/development-stages/03-development-plan.md`](./docs/development-stages/03-development-plan.md)
  - [`docs/development-stages/04-ai-usage.md`](./docs/development-stages/04-ai-usage.md)
  - [`docs/development-stages/05-delivery.md`](./docs/development-stages/05-delivery.md)
- **REST Countries**: [documentación oficial](https://restcountries.com/docs)
- **DynamoDB Local**: [guía de AWS](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)

---

## Licencia 📄

Este proyecto se publica bajo **The Unlicense** (dominio público). Ver [`LICENSE`](./LICENSE).

---

**¡Gracias por revisar External Validation Service!** 🛡️
