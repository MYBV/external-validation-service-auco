# 05 Entrega: trazabilidad, verificación y borradores

**Proyecto:** `external-validation-service-auco`  
**Estado:** Etapa 6 ejecutada e integrada en `main` (merge `3e31254`); revisión posterior del 19/11/2026 descrita en §6. Los textos de §5 son **borradores técnicos**, no aprobados para su envío.  
**Referencias:** [`01-requirements.md`](./01-requirements.md), [`02-architecture.md`](./02-architecture.md), [`03-development-plan.md`](./03-development-plan.md), [`04-ai-usage.md`](./04-ai-usage.md), [`../README.md`](../README.md)

## 1. Resultados realmente ejecutados en la Etapa 5

Entorno: Windows 11, Node 24.21.0, Docker 29.8.1 con MongoDB 8.3.17 (replica set) y DynamoDB Local 3.3.2 activos. Instalación con `npm ci` sobre un árbol sin `node_modules` ni `.env` (432 paquetes, 0 vulnerabilidades reportadas).

| Control | Resultado |
| --- | --- |
| `npm ci` | Correcto |
| `npm run typecheck` | Sin errores |
| `npm run lint:check` | Sin errores |
| `npm run format:check` | Sin diferencias |
| `npm run build` | Correcto |
| `npm run test` | 327 pruebas aprobadas (32 archivos); también sin `.env` |
| `npm run test:e2e` | 68 aprobadas (4 archivos); también sin `.env` |
| `npm run test:integration` | 64 aprobadas (6 archivos); sin `.env` falla con el mensaje explícito `DYNAMODB_ENDPOINT must be set explicitly...` |
| `npm run infra:init` ×2 | Ambas sin error y sin cambios (la base de desarrollo ya existía: `seed inserted 0`, tabla existente) |
| Total de pruebas automatizadas | **459** (coincide con la referencia de la Etapa 5) |

**Recorrido del README sobre recursos nuevos y aislados** (`MONGO_DB_NAME`/`DYNAMODB_TABLE` = `ev_readme_walk`, puerto 3399, eliminados después): `infra:init` insertó 2 países y **creó** la tabla; `GET /health` y `/docs` respondieron `200`; `POST` → `201`, replay con la misma `Idempotency-Key` → mismo `id`, contenido distinto → `409`, cuerpo inválido → `400`, país `AR` → `400`, sin clave → `401`, ID inexistente → `404`, ID malformado → `400`; `GET /validations/:id` → `200`; `aws dynamodb query` sobre `DOCUMENT#CO#TEST-123456` devolvió el evento `VALIDATION_CREATED`; el log de la aplicación no contenía el nombre, el documento ni la `API_KEY`.

> **Limitación de esta verificación:** el proveedor REST Countries se **sustituyó por un servidor local que imita la forma del contrato v5** (`REST_COUNTRIES_BASE_URL=http://127.0.0.1:4599`). Demuestra el flujo del servicio, **no** la integración con el proveedor real.

## 2. Matriz de cumplimiento del enunciado de Auco

| ID | Requisito | Implementación | Prueba automatizada | Estado real | Instrucción para el evaluador |
| --- | --- | --- | --- | --- | --- |
| R-01 | Servicio Node.js | `src/main.ts`, `src/app.setup.ts` | `test/bootstrap.e2e-spec.ts` | **Completo** | README «Inicio rápido» |
| R-02 | `POST /validations`: valida, enriquece, guarda en MongoDB, devuelve id | `validations.controller/service`, `rest-countries.service`, `validation.repository` | `validations.e2e-spec.ts`, `validations.service.spec.ts`, `validations.int-spec.ts` | **Completo**; el enriquecimiento con el proveedor real **no verificado** (sin API key) | `curl` del README; requiere `REST_COUNTRIES_API_KEY` propia |
| R-03 | `GET /validations/:id` | idem | `validations.e2e-spec.ts`, `validations.int-spec.ts` | **Completo** | `curl` del README |
| R-04 | Evento de auditoría en DynamoDB Local, llave por documento y fecha | `validation-audit.repository.ts`, `audit-publisher.service.ts` | `audit.int-spec.ts`, `validation-audit.repository.spec.ts` | **Completo** | `aws dynamodb query` del README |
| R-05 | Manejo de errores de la API externa | `rest-countries.service.ts`, `rest-countries.schema.ts` | `rest-countries.service.spec.ts`, `rest-countries.schema.spec.ts`, e2e | **Completo con dobles**; fallos reales del proveedor (`401`, `429`, cambios de esquema) no observados | `npm run smoke:rest-countries` |
| R-06 | ≥ 3 pruebas automatizadas | 459 pruebas (327 + 68 + 64) | `npm run test`, `test:e2e`, `test:integration` | **Completo** | README «Pruebas» |
| R-07 | README que explique cómo correrlo | `README.md` | verificado manualmente (§1) | **Completo** (recorrido hasta donde permite la falta de clave) | — |
| R-08 | Tres explicaciones (IA, llaves DynamoDB, mejoras) | §4 de este documento | — | **Borrador**; requiere revisión y aprobación humana | Copiar tras aprobar |
| Validación de entradas | Zod en cuerpo, headers, `id` y entorno | `create-validation*.schema.ts`, `zod-validation.pipe.ts`, `env.schema.ts` | `validations.e2e-spec.ts`, `env.schema.spec.ts` | **Completo** | — |
| Historial por documento | Consulta por partición `PK` | `listByDocument` (sin endpoint HTTP, no exigido) | `audit.int-spec.ts` | **Completo a nivel de repositorio**; sin endpoint | AWS CLI |
| Recuperación de auditorías | Outbox, worker, lease, backoff | `audit-recovery.worker.ts`, `outbox.repository.ts` | `audit-recovery.int-spec.ts`, `audit.int-spec.ts` | **Completo** | — |


## 3. Revisión de seguridad y limpieza

- `.env` no está versionado (`git check-ignore`); `git ls-files` no contiene `.env`, claves ni volúmenes. La búsqueda de patrones de credenciales solo encontró el literal `rc_live_demo` en advertencias.
- Credenciales de DynamoDB Local (`local`/`local`) son ficticias; el guard de infraestructura rechaza endpoints no locales.
- Los logs revisados (`AuditPublisher`, `AuditRecoveryWorker`, `AllExceptionFilter`, `RestCountriesService`) registran IDs, códigos de error y duraciones, no nombres, documentos ni claves; la ejecución real del recorrido no los emitió.
- Las respuestas de error no incluyen stack, credenciales ni valores recibidos.
- Los ejemplos usan solo datos ficticios (`Persona de ejemplo`, `TEST-123456`).
- Observación: el número de documento está en la `PK` de DynamoDB (requisito del enunciado) y en MongoDB; ver limitaciones del README.
- Los marcadores de `.env.example` superan la longitud mínima: se advierte en el archivo y en el README que deben sustituirse.

## 4. Borradores de las respuestas del formulario (no aprobados para envío)

### 4.1 Uso de IA

Usé Claude (Opus para revisar requisitos y arquitectura y para el saneamiento inicial del entorno; Sonnet para implementar cada etapa y sus pruebas) como asistente, y trabajé por etapas con un plan previo que yo revisaba antes de autorizar cada implementación; todas las operaciones de Git las hice yo. Le pedí revisar los requisitos, proponer la arquitectura (transacción MongoDB con outbox, escritura condicional en DynamoDB) y generar el código con sus pruebas. Tuve que corregir, entre otras cosas: que el fingerprint de idempotencia usara HMAC-SHA256 con un secreto independiente en lugar de un hash simple; que el timeout de la transacción de MongoDB no tenía efecto en el driver instalado (se añadió `maxCommitTimeMS` y la conciliación de un commit incierto, probada con un límite real de 1 ms); que la respuesta de REST Countries v5 usa `capitals` y devuelve `200` con `objects` vacío ante un código sin coincidencia; que el OpenAPI generado omitía el parámetro `id` del `GET`; y que los errores de validación de DynamoDB se trataban como permanentes, lo que habría perdido auditorías ante un error de configuración. Verifiqué los resultados ejecutando typecheck, lint, formato, build y 459 pruebas (327 unitarias, 68 e2e y 64 de integración contra MongoDB y DynamoDB Local reales). Las decisiones de diseño y la validación final son mías; la integración con la API real de REST Countries sigue pendiente de comprobar con una clave propia.

> Antes de enviar: confirmar cada corrección con `04-ai-usage.md` y los diffs, y ajustar a lo que la persona desarrolladora considere fiel. Distinguir qué corrigió la persona desarrolladora, qué detectó una revisión de IA (por ejemplo, el tratamiento de `ValidationException` vino del hallazgo M-1 de Opus) y qué salió de la documentación del proveedor (`capitals` y el `200` con `objects` vacío).

### 4.2 Justificación de las llaves de DynamoDB

`PK = DOCUMENT#<país>#<documento>` y `SK = <fecha ISO UTC>#<eventId>`. El enunciado pide una llave por documento y fecha: con el documento en la partición, todo el historial de un documento se consulta con un `Query` eficiente y sin escaneos. Incluí el país porque el mismo número puede existir en países distintos y no deben mezclar historiales. La sort key lleva la fecha en ISO UTC de ancho fijo, de modo que el orden lexicográfico es el cronológico, y el `eventId` estable desempata eventos del mismo milisegundo y permite que cada reintento escriba exactamente la misma llave; con un `ConditionExpression` esto hace la escritura idempotente (se comprueba que el ítem existente sea el mismo evento antes de aceptarlo como replay). Compromiso conocido: el documento queda dentro de la `PK`; en producción derivaría la partición con un HMAC y controlaría el acceso a la tabla.

### 4.3 Qué mejoraría con más tiempo

Validar la integración con REST Countries con una clave real y automatizar un chequeo manual en CI; proteger el documento (HMAC en la `PK`, cifrado de campos); exponer una consulta paginada del historial de auditoría; añadir readiness profundo y métricas del worker, y evaluar un `socketTimeoutMS` bajo carga para evitar ciclos bloqueados; autenticación por cliente con rotación de claves; pruebas con varias instancias; y despliegue con bases gestionadas.

### 4.4 Datos que deberá aportar la persona candidata (no se inventan aquí)

- URL del repositorio y permisos de acceso para quien evalúa.
- Datos personales y de contacto solicitados por el formulario.
- Instrucciones de credenciales: el evaluador debe usar **su propia** `REST_COUNTRIES_API_KEY` en un `.env` local; no se comparte públicamente ninguna clave. Si Auco ofrece un canal privado para compartirla, usarlo y nunca el repositorio.

## 5. Checklist de entrega

- [x] `POST /validations` y `GET /validations/:id` funcionan según el contrato (verificado con el proveedor simulado y con pruebas automatizadas).
- [ ] REST Countries enriquece con la API real (pendiente de clave propia).
- [x] MongoDB conserva la validación y DynamoDB Local contiene el evento con llaves documento/fecha.
- [x] Outbox, `201` tras commit, recuperación e idempotencia cubiertos por pruebas de integración.
- [x] Zod en entrada y entorno, errores externos, API key, health y Swagger.
- [x] ≥ 3 pruebas automatizadas (459 ejecutadas).
- [x] README con Node 24, Docker, entorno, replica set, `infra:init`, pruebas, Swagger y ejemplos.
- [ ] Respuestas escritas revisadas y aprobadas por la persona desarrolladora (borradores en §4).
- [x] Sin `.env`, secretos ni PII versionados (comprobado en esta etapa).
- [ ] Commit, push y permisos del repositorio (responsabilidad humana).

## 6. Cambios posteriores a la Etapa 6 (19/11/2026)

Revisión de humana y apoyo de OPUS para implementar cambios necesarios. Sin cambios de contrato HTTP, dependencias ni variables de entorno.

| Cambio | Archivos |
| --- | --- |
| Reconciliación del `E11000` del propio `_id` en la persistencia idempotente (antes respondía `500` en lugar de `201`) y publicación inline cuando el ganador de la clave es un intento propio | `src/validations/services/validations.service.ts` |
| Cinco pruebas unitarias nuevas | `src/validations/services/validations.service.spec.ts` |
| Justificación de D-10 (por qué no `503`, `202` ni escritura en DynamoDB dentro de la operación) e inspección de datos en MongoDB y DynamoDB Local | `README.md` |
| Descripción de la corrección y estados al día | `docs/01` a `docs/05` |

| Control | Resultado |
| --- | --- |
| `typecheck`, `lint:check`, `format:check` | Sin errores (ejecutados por Claude) |
| `npm run test:e2e` | 68 aprobadas (ejecutado por la persona desarrolladora) |
| `npm run test:integration` | 64 aprobadas (ejecutado por la persona desarrolladora) |
| `npm run test` | 330 aprobadas y 2 fallidas por un error de las pruebas nuevas, ya corregido; (se esperan 332) |

El total de pruebas pasará de 459 a 464 cuando se confirme la reejecución de `npm run test`.
