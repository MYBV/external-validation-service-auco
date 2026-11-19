# Índice de Documentación — External Validation Service

Este documento es el índice centralizado de la documentación del proyecto. Consúltalo primero para encontrar la documentación relevante antes de buscar en carpetas individuales.

**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Resumen del Servicio](#resumen-del-servicio)
2. [Endpoints del Sistema](#endpoints-del-sistema)
3. [Infraestructura y Servicios](#infraestructura-y-servicios)
4. [Guías de Desarrollo](#guías-de-desarrollo)
5. [Etapas de Desarrollo](#etapas-de-desarrollo)
6. [Referencia Rápida](#referencia-rápida)

---

## Resumen del Servicio

**External Validation Service** es un servicio NestJS (Node.js 24, TypeScript estricto, ESM) construido como prueba técnica para Auco.ai.

**Responsabilidades:**

- Recibir un nombre y un número de documento (`POST /validations`) y validar las entradas con Zod.
- Enriquecer el registro con datos geográficos del país indicado, consultando **REST Countries v5**.
- Guardar la validación en **MongoDB** y devolver su `id`.
- Registrar un evento de auditoría por cada creación en **DynamoDB**, con llave por documento y fecha, mediante un outbox transaccional.
- Devolver el registro guardado (`GET /validations/:id`).

**No hace:**

- Verificar identidad, titularidad documental, residencia ni nacionalidad.
- Deducir el país a partir del número de documento.
- Exponer CRUD de países ni el historial de auditoría por HTTP.

---

## Endpoints del Sistema

| Endpoint | Documento | Autenticación |
| --- | --- | --- |
| **POST /validations** · **GET /validations/:id** | [`endpoints/validations.md`](./endpoints/validations.md) | `x-api-key` |
| **GET /health** · **GET /docs** (Swagger) | [`endpoints/health.md`](./endpoints/health.md) | Pública |

### Validations

**Ubicación**: [`endpoints/validations.md`](./endpoints/validations.md)

**Endpoints**:

- `POST /validations` — Crea una validación enriquecida; responde `201 { data: { id } }` tras el commit de MongoDB.
- `GET /validations/:id` — Devuelve la validación guardada.

**Headers**: `x-api-key` en ambos; `x-country-code` obligatorio solo en `POST`; `Idempotency-Key` opcional en `POST`.

---

### Health y Swagger

**Ubicación**: [`endpoints/health.md`](./endpoints/health.md)

**Endpoints**:

- `GET /health` — Liveness básico, público.
- `GET /docs` — Swagger UI, solo con `SWAGGER_ENABLED=true`.

---

## Infraestructura y Servicios

### Documentos de Infraestructura

| Documento | Ubicación | Descripción |
| --- | --- | --- |
| **Configuración y Arranque** | [`infrastructure/configuracion-arranque.md`](./infrastructure/configuracion-arranque.md) | Grafo de módulos, variables de entorno, secuencia de arranque y apagado, `infra:init`, Docker Compose |
| **Request Context** | [`infrastructure/request-context.md`](./infrastructure/request-context.md) | Contexto por request con AsyncLocalStorage y `x-request-id` |
| **Pipeline HTTP** | [`infrastructure/pipeline-http.md`](./infrastructure/pipeline-http.md) | API key, validación Zod, `{ data }`, timeout, contrato de error y Swagger |
| **MongoDB Arquitectura** | [`infrastructure/mongodb-arquitectura.md`](./infrastructure/mongodb-arquitectura.md) | Driver nativo, transacciones, repositorio base, colecciones e índices |
| **DynamoDB Arquitectura** | [`infrastructure/dynamodb-arquitectura.md`](./infrastructure/dynamodb-arquitectura.md) | SDK v3, salvaguardas, repositorio base, tabla y diseño de llaves PK/SK |
| **Auditoría y Outbox** | [`infrastructure/auditoria-outbox.md`](./infrastructure/auditoria-outbox.md) | Outbox transaccional, publicación inline, worker, lease, errores y escenarios de fallo |
| **Idempotencia** | [`infrastructure/idempotencia.md`](./infrastructure/idempotencia.md) | `Idempotency-Key`, huella HMAC, concurrencia e `IDEMPOTENCY_HASH_SECRET` |
| **Enriquecimiento REST Countries** | [`infrastructure/enriquecimiento-rest-countries.md`](./infrastructure/enriquecimiento-rest-countries.md) | Contrato v5, validación Zod, mapeo, errores y smoke test |
| **Catálogo de Países** | [`infrastructure/catalogo-paises.md`](./infrastructure/catalogo-paises.md) | Colección `countries`, seed idempotente y validación de `x-country-code` |

---

### Configuración y Arranque

**Ubicación**: [`infrastructure/configuracion-arranque.md`](./infrastructure/configuracion-arranque.md)

**Descripción**: Cómo se valida el entorno con Zod, qué módulo exige cada variable, en qué orden arranca el servicio, qué hace `npm run infra:init` y cómo se levanta el entorno local.

**Cuándo consultar**:

- Para configurar el `.env` o entender por qué el servicio no arranca.
- Al agregar una variable de entorno o un módulo nuevo.
- Para preparar MongoDB (replica set, índices, seed) y DynamoDB Local.
- Para levantar el servicio con Docker Compose en cualquiera de sus dos modos.

---

### Request Context

**Ubicación**: [`infrastructure/request-context.md`](./infrastructure/request-context.md)

**Descripción**: Contexto inmutable por request con `requestId`, ruta, hora de inicio y país de correlación, usando una única instancia de `AsyncLocalStorage`.

**Componentes**: `RequestContextService`, `RequestContextMiddleware`, `@CurrentContext()`.

**Cuándo consultar**:

- Para correlacionar logs y errores con `x-request-id`.
- Al usar el contexto desde un servicio nuevo.
- Para entender por qué el worker de auditoría no tiene contexto.

---

### Pipeline HTTP

**Ubicación**: [`infrastructure/pipeline-http.md`](./infrastructure/pipeline-http.md)

**Descripción**: Componentes globales que procesan cada request: `ApiKeyGuard`, `@Public()`, `ZodValidationPipe`, `ResponseInterceptor`, `TimeOutInterceptor`, `AllExceptionFilter` y `configureApp()`.

**Cuándo consultar**:

- Al crear un endpoint (protección, validación, formato de respuesta).
- Para entender un código o mensaje de error.
- Al configurar Swagger.

---

### MongoDB Arquitectura

**Ubicación**: [`infrastructure/mongodb-arquitectura.md`](./infrastructure/mongodb-arquitectura.md)

**Descripción**: Uso del driver nativo sin Mongoose, `MongoService` y sus transacciones, `MongoRepository<T>`, colecciones e índices, clasificación de errores y límites de tiempo del driver.

**Cuándo consultar**:

- Al crear un repositorio o una colección.
- Al escribir código que use transacciones.
- Para interpretar `E11000` o un commit incierto.

---

### DynamoDB Arquitectura

**Ubicación**: [`infrastructure/dynamodb-arquitectura.md`](./infrastructure/dynamodb-arquitectura.md)

**Descripción**: `DynamoService`, salvaguardas contra AWS real, `DynamoRepository<T>`, la tabla `validation_audit`, el ítem de auditoría y la justificación de las llaves `PK`/`SK`.

**Cuándo consultar**:

- Para entender o justificar el diseño de llaves.
- Al consultar el historial de un documento.
- Al agregar una tabla o un patrón de acceso.

---

### Auditoría y Outbox

**Ubicación**: [`infrastructure/auditoria-outbox.md`](./infrastructure/auditoria-outbox.md)

**Descripción**: Por qué se responde `201` tras el commit de MongoDB, cómo se entrega cada evento a DynamoDB (inline y worker), el claim con lease, la clasificación de errores, el backoff y el comportamiento ante cada tipo de fallo.

**Cuándo consultar**:

- Para explicar la política ante un fallo parcial entre MongoDB y DynamoDB.
- Para diagnosticar eventos `PENDING` o `FAILED`.
- Al ajustar las variables `AUDIT_*`.

---

### Idempotencia

**Ubicación**: [`infrastructure/idempotencia.md`](./infrastructure/idempotencia.md)

**Descripción**: Idempotencia HTTP opcional con `Idempotency-Key` (huella HMAC, índice único parcial, persistencia acotada) e idempotencia obligatoria de la auditoría.

**Cuándo consultar**:

- Para integrar un cliente que reintenta solicitudes.
- Para configurar `IDEMPOTENCY_HASH_SECRET`.
- Para interpretar un `409` o un `503` con "retry with the same Idempotency-Key".

---

### Enriquecimiento REST Countries

**Ubicación**: [`infrastructure/enriquecimiento-rest-countries.md`](./infrastructure/enriquecimiento-rest-countries.md)

**Descripción**: Integración con REST Countries v5: contrato, autenticación, validación Zod de la respuesta, datos guardados, traducción de errores (`502`, `503`, `504`) y smoke test con clave real.

**Cuándo consultar**:

- Para obtener o configurar `REST_COUNTRIES_API_KEY`.
- Para diagnosticar un `502`, `503` o `504` del `POST`.
- Al integrar otro servicio externo (como referencia).

---

### Catálogo de Países

**Ubicación**: [`infrastructure/catalogo-paises.md`](./infrastructure/catalogo-paises.md)

**Descripción**: Por qué el país va en `x-country-code`, la colección `countries`, el seed idempotente (`CO`, `MX`) y la validación del país en tres capas.

**Cuándo consultar**:

- Para un `400 Unsupported country code`.
- Para habilitar, deshabilitar o agregar un país.

---

## Guías de Desarrollo

| Guía | Documento | Descripción |
| --- | --- | --- |
| **Cómo agregar un endpoint** | [`guides/how-to-add-endpoint.md`](./guides/how-to-add-endpoint.md) | Esquemas Zod → interfaces → repositorio → servicio → mapper → Swagger → controller → módulo → pruebas → documentación |

---

## Etapas de Desarrollo

Documentos de trabajo usados durante la construcción del servicio con asistencia de IA. Registran requisitos, decisiones (D-01 a D-25) y su historia; la documentación técnica vigente es la de las secciones anteriores.

| Documento | Contenido |
| --- | --- |
| [`development-stages/01-requirements.md`](./development-stages/01-requirements.md) | Enunciado original de Auco, matriz de requisitos y criterios de aceptación |
| [`development-stages/02-architecture.md`](./development-stages/02-architecture.md) | Arquitectura y registro de decisiones |
| [`development-stages/03-development-plan.md`](./development-stages/03-development-plan.md) | Plan por etapas y verificaciones |
| [`development-stages/04-ai-usage.md`](./development-stages/04-ai-usage.md) | Registro del uso de IA y de las correcciones |
| [`development-stages/05-delivery.md`](./development-stages/05-delivery.md) | Trazabilidad, resultados de pruebas y borradores de entrega |

---

## Referencia Rápida

### Estructura de Carpetas

```
external-validation-service-auco/
├── docs/
│   ├── documentation-index.md            # ← Este archivo
│   ├── endpoints/
│   │   ├── validations.md
│   │   └── health.md
│   ├── infrastructure/
│   │   ├── configuracion-arranque.md
│   │   ├── request-context.md
│   │   ├── pipeline-http.md
│   │   ├── mongodb-arquitectura.md
│   │   ├── dynamodb-arquitectura.md
│   │   ├── auditoria-outbox.md
│   │   ├── idempotencia.md
│   │   ├── enriquecimiento-rest-countries.md
│   │   └── catalogo-paises.md
│   ├── guides/
│   │   └── how-to-add-endpoint.md
│   └── development-stages/               # requisitos, arquitectura, plan, IA, entrega
├── src/
│   ├── common/        # contexto, guard, pipes, interceptors, filtro
│   ├── config/        # esquema Zod del entorno y configuración tipada
│   ├── database/      # MongoModule, DynamoModule e infra:init
│   ├── countries/     # catálogo de países
│   ├── enrichment/    # cliente REST Countries v5
│   ├── validations/   # endpoints, transacción e idempotencia
│   ├── audit/         # outbox, publicador y worker
│   └── health/        # GET /health
├── test/              # e2e e integración
├── scripts/           # smoke test de REST Countries
└── README.md          # descripción, inicio rápido, inspección de datos
```

### URL Base

```
http://localhost:3300      # PORT de .env.example (por defecto 3000); sin prefijo ni versión
```

### Headers

```
x-api-key:        <API_KEY>        # todas las rutas salvo /health y /docs
x-country-code:   CO               # solo POST /validations
Idempotency-Key:  <8-128 chars>    # opcional en POST /validations
```

Todas las respuestas incluyen `x-request-id`.

### Comandos Frecuentes

```bash
# Modo 1: bases en Docker, API en el host
docker compose up -d          # MongoDB (replica set) y DynamoDB Local
npm run infra:init            # índices, seed de países y tabla DynamoDB (idempotente)
npm run start:dev             # servicio en modo desarrollo

# Modo 2: todo en contenedores (bases, infra-init y API)
docker compose --profile app up -d --build
docker compose --profile app down      # detener ambos modos (-v borra los datos)

# Pruebas
npm run test                  # unitarias
npm run test:e2e              # HTTP con Supertest
npm run test:integration      # contra MongoDB y DynamoDB Local reales
npm run smoke:rest-countries  # una consulta real a REST Countries (requiere clave)
```

### Convenciones de Documentación

1. **Índice primero**: consultar este archivo antes de buscar en carpetas.
2. **Metadata**: cada documento enlaza al índice e indica proyecto y fecha.
3. **Tabla de contenidos** en los documentos largos.
4. **Referencias cruzadas** con rutas relativas.
5. **Idioma**: documentación en español; código, identificadores, Swagger y respuestas de la API en inglés.
6. **Exactitud**: describir lo que hace el código; lo que falta se presenta como limitación o mejora futura, nunca como implementado.

---

**Última actualización**: Noviembre 2026
