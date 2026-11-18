# 01 — Requisitos y criterios de aceptación

**Proyecto:** `external-validation-service-auco`  
**Estado:** Borrador para revisión de arquitectura; no autoriza todavía la implementación  
**Documentos relacionados:** [`02-architecture.md`](./02-architecture.md), [`03-development-plan.md`](./03-development-plan.md), [`04-ai-usage.md`](./04-ai-usage.md)

## 1. Enunciado original de la prueba técnica (requisitos de Auco)

> Construir un servicio en Node.js con dos endpoints:
>
> - `POST /validations`: recibe un nombre y un número de documento, consulta una API pública gratuita (por ejemplo, una de países o de tipo de cambio) para enriquecer el registro, lo guarda en MongoDB y responde con un id.
> - `GET /validations/:id`: devuelve el registro guardado.
>
> Además, cada creación debe escribir un evento de auditoría en DynamoDB Local, con llave por documento y fecha.
>
> El servicio debe incluir:
>
> - Validación de entradas.
> - Manejo de errores de la API externa.
> - Al menos tres pruebas automatizadas.
> - Un README que explique cómo correrlo.
>
> **Qué debes entregar además del código:**
>
> 1. Un párrafo sobre cómo usaste la IA: qué le pediste y qué tuviste que corregir.
> 2. Por qué elegiste esas llaves en DynamoDB.
> 3. Qué mejorarías con más tiempo.

**Regla de alcance:** Ninguna propuesta de las secciones siguientes constituye un requisito explícito de Auco, salvo que también aparezca en este enunciado.

## 2. Matriz de requisitos y mejoras propias

| ID   | Requisito o decisión                                    | Clasificación                     | Criterio de aceptación                                                      |
| ---- | ------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| R-01 | Servicio HTTP en Node.js                                | **Auco**                          | El servicio inicia y acepta solicitudes HTTP.                               |
| R-02 | `POST /validations` con `name` y `documentNumber`       | **Auco**                          | Valida datos, enriquece con API pública, persiste en MongoDB y devuelve ID. |
| R-03 | `GET /validations/:id`                                  | **Auco**                          | Devuelve el registro persistido o un error apropiado.                       |
| R-04 | Evento de auditoría por creación en DynamoDB Local      | **Auco**                          | Se verifica un evento con llaves basadas en documento y fecha.              |
| R-05 | Manejo de errores de API externa                        | **Auco**                          | Distingue errores HTTP, red, timeout y respuestas inválidas.                |
| R-06 | Al menos tres pruebas automatizadas                     | **Auco**                          | Pruebas ejecutables con resultados satisfactorios.                          |
| R-07 | README reproducible                                     | **Auco**                          | Otra persona puede iniciar y probar el servicio siguiendo instrucciones.    |
| R-08 | Tres explicaciones escritas                             | **Auco**                          | Uso real de IA, justificación de llaves DynamoDB y mejoras futuras.         |
| A-01 | NestJS 12, TypeScript estricto, ESM nativo, Node.js 24  | **Mejora propia**                 | Compilación, verificación de tipos, lint y pruebas operativos.              |
| A-02 | Zod para entorno, entradas y respuestas externas        | **Mejora propia**                 | Configuración inválida falla al inicio; entradas inválidas devuelven `400`. |
| A-03 | REST Countries para enriquecimiento geográfico          | **Elección propia de API**        | Recupera información del país sin enviar datos personales.                  |
| A-04 | Catálogo `countries` en MongoDB y seed idempotente      | **Mejora propia**                 | Índice único por código; ejecutar seed dos veces no duplica registros.      |
| A-05 | Header obligatorio `x-country-code` en POST             | **Extensión propia del contrato** | Normalizado y validado contra países habilitados.                           |
| A-06 | API key en los endpoints de validaciones                | **Extensión propia del contrato** | Llave faltante o inválida devuelve `401`; `/health` público.                |
| A-07 | Swagger/OpenAPI y endpoint de salud                     | **Mejora propia**                 | Esquemas y seguridad documentados; `GET /health` responde.                  |
| A-08 | Driver MongoDB nativo y repositorio base mínimo         | **Mejora propia**                 | Sin Mongoose ni operaciones CRUD innecesarias.                              |
| A-09 | SDK AWS v3 y repositorio DynamoDB separado              | **Mejora propia**                 | Escrituras reales en DynamoDB Local y prevención de duplicados.             |
| A-10 | Transacción MongoDB y outbox persistente                | **Mejora propia**                 | Validación y evento pendiente se confirman atómicamente.                    |
| A-11 | Idempotencia HTTP y de eventos                          | **Mejora propia**                 | Reintentos de la misma operación no generan duplicados.                     |
| A-12 | Correlación mediante AsyncLocalStorage                  | **Mejora propia**                 | Contexto por solicitud sin registrar datos personales.                      |
| A-13 | Vitest unitario, integración y e2e                      | **Mejora propia**                 | Escenarios críticos automatizados.                                          |
| A-14 | Docker Compose con MongoDB replica set y DynamoDB Local | **Mejora propia**                 | Operaciones y transacciones verificables localmente.                        |

## 3. Contratos HTTP

### 3.1 `POST /validations`

**Headers**

- `x-api-key`: obligatorio; llave compartida de desarrollo desde configuración validada; nunca registrar su valor.
- `x-country-code`: obligatorio; código ISO 3166-1 alfa-2, por ejemplo `CO` o `MX`. Normalizar a mayúsculas y comprobar que exista y esté habilitado en `countries`.
- `Idempotency-Key`: **propuesta de mejora obligatoria**, aún sujeta a revisión. Determinar si exigirlo o hacerlo opcional sin impedir al evaluador usar el contrato mínimo de Auco (§10).

**Body JSON**

```json
{
  "name": "Persona de ejemplo",
  "documentNumber": "TEST-123456"
}
```

Los campos son cadenas de texto, no identificadores numéricos. Validar y normalizar sin alterar nombres o formatos documentales legítimos. Establecer límites razonables con Zod y rechazar campos desconocidos. No deducir país, residencia, nacionalidad ni tipo de documento a partir del número. Utilizar exclusivamente datos ficticios en ejemplos y pruebas.

**Éxito esperado:** `201 Created` con al menos el ID creado. Se admite un envoltorio mínimo y consistente, por ejemplo `data.id` y `requestId`, si se documenta y prueba. La política cuando DynamoDB falla sigue **provisional** (§10).

**Flujo:** guard API key → Zod (body/header) → país habilitado → REST Countries → transacción MongoDB (validación + evento outbox `PENDING`) → intento de auditoría DynamoDB → respuesta según política aprobada. Si DynamoDB falla, conservar evento pendiente para recuperación.

**Errores:** datos o headers malformados (`400`), API key ausente/inválida (`401`), país desconocido/deshabilitado (`400` o `422`, **por decidir**), fallo del proveedor/estructura inválida (`502`), timeout (`504`), reutilización de clave de idempotencia con diferente contenido (`409`), auditoría no disponible (`503` provisional). No filtrar información sensible.

### 3.2 `GET /validations/:id`

- Exige `x-api-key`.
- Consulta MongoDB por ID sin volver a consumir REST Countries ni DynamoDB.
- Devuelve `200 OK` con registro guardado; `404 Not Found` si no existe.
- Un ObjectId malformado produce `400 Bad Request`.
- La representación pública convierte `_id` a `id` y omite detalles internos del outbox o secretos.
- **Decisión a revisar:** el alcance recomendado exige `x-country-code` únicamente en POST; GET ya identifica un recurso por ID. Si se requiere también en GET, documentarlo como restricción propia adicional. Revisar la diferencia con cualquier regla previa que diga genéricamente «endpoints de validaciones».

### 3.3 `GET /health`

- Público y sin API key.
- Devuelve `200` con información mínima, por ejemplo `{ "status": "ok" }`, cuando el servicio HTTP está operativo.
- No revelar credenciales, hosts internos, topología de DB ni datos personales.
- Tratarlo como liveness básico; readiness profundo puede agregarse por separado en el futuro.

### 3.4 Swagger y rutas

- Swagger UI habilitable con `SWAGGER_ENABLED` (puede estar activo en desarrollo y deshabilitado por defecto en producción).
- Documentar API key mediante `DocumentBuilder.addApiKey(...)`, `@ApiSecurity('api-key')` y header `x-api-key`.
- Metadata en constantes generales y archivos por módulo, evitando controllers extensos.
- Swagger **documenta**, pero solo el guard **protege** los endpoints.
- Mantener accesibles `/validations`, `/validations/:id` y `/health` sin prefijo `/api/v1` obligatorio.

## 4. Enriquecimiento geográfico

- La API elegida es **REST Countries**.
- El país procede únicamente del `x-country-code` explícito del cliente, tras validar el catálogo local.
- Solicitar y persistir solo campos útiles; validar con Zod la respuesta de REST Countries. Posible fotografía mínima: código, nombre común/oficial, región, subregión, capital, idiomas/monedas opcionales, fuente y `enrichedAt`.
- No enviar `name`, `documentNumber`, API key ni otros datos personales al servicio externo.
- El enriquecimiento **no verifica identidad, autenticidad documental, residencia ni nacionalidad**.
- Un fallo del proveedor no debe transformarse silenciosamente en enriquecimiento ficticio ni estado `VERIFIED`.
- URL base y timeout configurados mediante entorno validado; la API pública no requiere una llave propia.

## 5. Catálogo de países y seed

- Colección MongoDB: `countries`.
- Campos mínimos: `code` (ISO alfa-2 mayúsculas), `name`, `enabled`, timestamps opcionales. Índice único `{ code: 1 }`.
- Seed inicial de Colombia (`CO`) y México (`MX`). Cualquier país adicional debe justificarse;.
- Seed repetible usando `updateOne({ code }, { $setOnInsert: ... }, { upsert: true })`, sin sobrescribir modificaciones existentes.
- No se requieren endpoints públicos CRUD de países.

## 6. Persistencia y auditoría

**MongoDB:** usar exclusivamente el driver nativo. `MongoRepository<T>` pequeño, reutilizable y extensible; nada de Mongoose, soft delete, paginación, `process.exit()` en repositorios ni conversiones indiscriminadas a `InternalServerErrorException`.

**DynamoDB Local:** SDK AWS v3: `DynamoDBClient` y `DynamoDBDocumentClient`. `DynamoRepository<T>` separado, extendido por `ValidationAuditRepository`. Por cada validación **nueva**, generar un evento con partición por documento y ordenamiento por fecha más ID estable:

```text
PK = DOCUMENT#TEST-123456
SK = 2026-11-18T15:30:00.000Z#<stable-event-id>
```

- Fecha ISO UTC. Se puede consultar el historial del documento en orden cronológico y diferenciar eventos del mismo milisegundo.
- Una identidad de evento estable permite reintentar la misma escritura. Aplicar `ConditionExpression` para impedir sobrescribir una llave existente. Una falla condicional solo cuenta como éxito idempotente **tras comprobar que el registro existente corresponde al mismo evento**.
- El documento en `PK` es potencialmente sensible: no mostrarlo en logs; contemplar seudonimización/HMAC y controles de acceso para producción.

**Outbox transaccional:** una transacción MongoDB guarda validación y evento de auditoría pendiente; el replica set local es obligatorio. El publicador intenta escribir en DynamoDB y registra el resultado. La recuperación debe ser real y duradera: no dejar eventos bloqueados para siempre tras caída del proceso.

**Dos idempotencias distintas:**

1. HTTP: clave estable suministrada por cliente, fingerprint y restricción única; `requestId` de AsyncLocalStorage **no** es la clave de idempotencia.
2. Auditoría: `eventId` estable más escritura condicional DynamoDB.

## 7. Seguridad, errores y observabilidad

- Guard global de API key con excepción explícita `@Public()` para health. Ausencia o error de API key → `401`. Configurar en `.env` validado con Zod, comparar adecuadamente y no registrar el secreto.
- Middleware con AsyncLocalStorage e interfaz `IRequestContext`: `requestId`, `requestUrl`, `startedAt`, `countryCode`. Se asigna país al validar su header; responder `x-request-id`.
- `@CurrentContext()` vive en `common/decorators`; pasar el contexto a cada servicio no es obligatorio cuando solo necesita consultar correlación en `RequestContextService`.
- `app.setup.ts` configura el pipeline HTTP y es reutilizado por tests e2e; `main.ts` permanece mínimo.
- Conservar `TimeOutInterceptor` y un `ResponseInterceptor` mínimo para éxitos; eliminar interceptors de request/global redundantes. Los timeouts RxJS **no cancelan necesariamente** escrituras en curso; agregar timeouts de dependencias.
- Un filtro global de excepciones debe conservar códigos HTTP pertinentes, mapear fallos de infraestructura con seguridad y responder `requestId`, `timestamp`, `path` sin stack traces, credenciales ni datos personales.
- Consumir REST Countries usando `HttpModule` de NestJS. Registrar solo metadata acotada: servicio, operación, estado, duración y correlación; nunca bodies completos.

## 8. Convenciones y controles de calidad

- Node.js 24, NestJS 12, TypeScript 6, ESM nativo y tipado estricto.
- Prefijo `I` para interfaces (`IValidation`, `ICountry`, `IRequestContext`); usar `type` para uniones, alias e inferencias Zod.
- `unknown` para datos externos; prohibir `any`, aserciones inseguras y `!` innecesarios.
- Zod para entorno, solicitudes y datos del proveedor; integrar Standard Schema de NestJS cuando corresponda.
- Prettier: `{ "singleQuote": true, "trailingComma": "all" }`; ESLint compatible con TypeScript.
- Módulos y carpetas solo cuando aporten valor; no scaffolding vacío ni abstracciones sin uso.
- Solo `CommonModule` es global; `DatabaseModule` encapsula infraestructura; los módulos de dominio no son globales.
- Claude no ejecuta commits ni push; la persona desarrolladora revisa cambios y gestiona Git.

## 9. Pruebas automatizadas

**Mínimo de Auco:** tres pruebas. **Meta propia:** cobertura relevante en Vitest de:

- POST válido → `201`, registro MongoDB y evento DynamoDB.
- Body/header inválido → error adecuado y ninguna persistencia.
- GET existente, ausente o ID inválido → `200`, `404`, `400`.
- API key ausente/inválida → `401` en validaciones; `/health` público.
- País válido/deshabilitado/no permitido, índice único y seed idempotente.
- REST Countries correcto, timeout, error HTTP y respuesta inválida (mocks en unitarias).
- Atomicidad de transacción: una inserción fallida revierte validación y outbox.
- Falla de DynamoDB deja evento pendiente; la recuperación lo publica.
- Escritura condicional e idempotencia HTTP impiden duplicados; misma clave y payload distinto → `409`.
- Respuestas sin datos sensibles; correlación mediante `x-request-id`.

Usar mocks para pruebas unitarias e integración dirigida contra MongoDB replica set y DynamoDB Local. Las e2e deben reutilizar `configureApp()`.

## 10. Decisiones pendientes de revisión explícita

**No convertir estos puntos en requisitos cerrados sin aprobación:**

1. **Confirmación de auditoría:** recomendación provisional: `201 Created` solo tras confirmar validación/outbox en MongoDB **y** evento en DynamoDB. Si DynamoDB falla, `503 Service Unavailable` y evento `PENDING` recuperable. Reintentar con misma clave reutiliza la operación. Alternativa: `201` tras outbox duradero con auditoría eventual; el enunciado no impone una política. Incorporar respuesta de Auco si llega.
2. **`Idempotency-Key`:** determinar si será obligatorio en POST u opcional con alternativa documentada para que el evaluador pruebe el contrato mínimo.
3. **Header del país:** obligatorio en POST. Revisar si GET debe requerirlo (recomendación: no).
4. **Recuperación local del outbox:** definir scheduler pequeño y recuperación al inicio, con concurrencia/reintentos controlados, sin infraestructura SQS innecesaria.
5. **Contrato de respuesta:** definir envoltorio mínimo, códigos y errores de Zod de forma coherente, incluyendo `id` requerido por Auco.
6. **Esquema actual de REST Countries:** verificar endpoint público y campos vigentes; fijar esquema Zod esperado.
7. **Inicialización de infraestructura:** crear tabla DynamoDB, índices MongoDB y seed de forma idempotente, sin pasos manuales ocultos.

## 11. Fuera de alcance

- Verificación real de identidad o titularidad documental, biometría, evaluación de fraude, KYC y registros gubernamentales.
- Estados reales de verificación en el flujo actual. Documentar únicamente como diseño futuro: `NOT_VERIFIED`, `VERIFIED`, `REJECTED`, `UNAVAILABLE`.
- JWT, OAuth/OIDC, cuentas de usuario, autorización multitenant o interfaz de administración de API keys.
- CRUD público adicional, frontend/Next.js, despliegue productivo en AWS.
- Mongoose, ORM, soft delete, paginación y métodos genéricos sin uso.
- Datos personales reales en fixtures o ejemplos.

**Razones para excluir verificación de identidad:** (1) el enunciado solo solicita nombre y número, sin país ni tipo documental, por lo que una verificación confiable es ambigua; (2) las fuentes confiables requieren validar procedencia, cobertura y tratamiento de datos personales; (3) integrarla excedería los objetivos evaluados. En el futuro se podría añadir `IdentityVerificationService` independiente de `EnrichmentService`.

## 12. Checklist de entrega

- [ ] Funcionan `POST /validations` y `GET /validations/:id` según el contrato documentado.
- [ ] REST Countries enriquece sin recibir PII.
- [ ] MongoDB conserva la validación y DynamoDB Local contiene el evento con llaves documento/fecha.
- [ ] Outbox transaccional y escenarios de reintento/idempotencia probados.
- [ ] Zod para entrada y entorno, errores externos, API key, health y Swagger.
- [ ] Al menos tres pruebas automatizadas aprobadas, idealmente suite más amplia.
- [ ] README: Node.js 24, Docker, entorno, replica set, seed, tabla, tests, Swagger y ejemplos `curl`.
- [ ] Respuestas escritas: uso real/correcciones de IA, llaves DynamoDB y mejoras futuras.
- [ ] No subir secretos, `.env` local ni datos persistidos de Docker.
