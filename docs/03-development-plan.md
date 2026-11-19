# 03  Plan de desarrollo incremental

**Proyecto:** `external-validation-service-auco`  
**Estado:** Plan actualizado con D-10 y D-11 aprobadas; ejecutar cada etapa solo tras revisión y aprobación de la persona desarrolladora  
**Referencias:** [`01-requirements.md`](./01-requirements.md), [`02-architecture.md`](./02-architecture.md), [`04-ai-usage.md`](./04-ai-usage.md)

## 1. Forma de trabajo

- **Persona desarrolladora:** decide arquitectura, revisa diffs, ejecuta o verifica controles de calidad y realiza manualmente todas las operaciones Git.
- **Claude Opus:** revisa requisitos, consistencia entre bases, riesgos, planes de pruebas y decisiones importantes. No puede reescribir silenciosamente acuerdos aprobados.
- **Claude Sonnet:** implementa **una etapa aprobada a la vez**, junto con pruebas y explicación de cambios; no hace commits.
- Cada etapa comienza leyendo `CLAUDE.md`, las reglas relevantes de `.claude/rules/` y las secciones relacionadas de `docs/`. El código de proyectos anteriores es inspiración, no fuente literal.
- Los resultados de las pruebas deben corresponder a comandos **realmente ejecutados**. No declarar éxito de un control que no pudo ejecutarse.
- Si hay incertidumbre sobre versiones o APIs, verificar documentación oficial antes de elegir configuraciones sensibles a versiones.

## 2. Estado inicial existente: verificar, no asumir

Antes de implementar, inspeccionar el repositorio real:

- [ ] Existe `external-validation-service-auco` y está inicializado con NestJS 12, ESM y TypeScript 6.
- [ ] Árbol de trabajo Git limpio; los commits pertenecen exclusivamente a la persona desarrolladora.
- [ ] `npm ci`, build, tests y linter configurado funcionan; revisar scripts reales de `package.json`.
- [ ] `Dockerfile`, `.dockerignore`, `docker-compose.yml` están en raíz.
- [ ] Docker expone MongoDB por `27018` y DynamoDB Local por `8001` para Node en Windows.
- [ ] Replica set MongoDB informa `PRIMARY` y se verifica transacción con commit **y rollback**.
- [ ] DynamoDB Local responde `ListTables` y persiste tras reinicio. Resolver primero los permisos SQLite del volumen; `docker compose ps` por sí solo no lo prueba.
- [ ] `.env` está fuera de Git y `.env.example` no contiene secretos reales.
- [ ] Existen `CLAUDE.md`, `.claude/rules/` y configuración compartida coherente.

**No desarrollar módulos nuevos sin revisar estas comprobaciones o dejar registradas las limitaciones aceptadas.**

## 3. Etapa 0  Revisión y aprobación de requisitos y arquitectura (Opus)

**Entradas:** `01-requirements.md`, `02-architecture.md`, este plan, `CLAUDE.md` y el repositorio real.

**Tareas:**

1. Trazar cada requisito original de Auco hacia el comportamiento y la prueba correspondientes.
2. Examinar las extensiones de contrato (`x-api-key`, `x-country-code`, `Idempotency-Key`).
3. **Verificar coherencia de D-10 ya aprobada:** `201` tras commit de validación + outbox, aunque DynamoDB falle después, con publicación de mejor esfuerzo y recuperación eventual. No reabrir la decisión sin justificar un riesgo demostrable.
4. **Verificar coherencia de D-11 ya aprobada:** `Idempotency-Key` opcional, replay de misma operación y `409` ante conflicto. El alcance de `x-country-code` en GET continúa pendiente (recomendación: solo POST).
5. Seleccionar la implementación mínima para publicación/recuperación del outbox y protección ante concurrencia, evitando infraestructura innecesaria.
6. Confirmar compatibilidad actual de NestJS 12, Zod/Standard Schema, TypeScript 6, `HttpModule`, MongoDB driver y SDK AWS.
7. Presentar cambios justificados. Solo modificar documentos tras aprobación humana.

**Criterio de cierre:** no existen decisiones críticas abiertas que bloqueen la implementación; registro de decisiones actualizado.

**Commit sugerido (solo persona desarrolladora):** `docs: adopt eventual audit delivery and optional request idempotency`.

## 3.1 Etapa 0.5  Saneamiento del entorno (propuesta de Opus, pendiente de aprobación)

Antes de la Etapa 1, verificar los hallazgos de la primera revisión contra el **estado actual** del repositorio y corregir solo los confirmados, previa autorización:

- MongoDB publicado en `27018`: URI host correcta, replica set `rs0` iniciado de forma idempotente, transacción de commit y rollback comprobadas; DynamoDB Local funcional y persistente.
- `.env.example` versionable pese a las reglas de `.gitignore`.
- Scripts reales de `package.json`: `test:e2e` apunta a la configuración existente, `typecheck`, `format:check` y `lint:check` no modifican archivos; el lint de corrección se separa del control de calidad.
- Reglas en `.claude/rules/` efectivamente cargables; ESLint alineado con la prohibición de `any`.
- Confirmar mediante tests reales que Vitest resuelve DI y metadata de decoradores NestJS (configurar `unplugin-swc` solo si es necesario).

**Cierre:** comprobaciones reproducibles y evidencia de tests; no asumir que los hallazgos de Opus siguen abiertos tras cambios locales. Ejecutar esta etapa únicamente si se aprueba.

## 4. Etapa 1  Bootstrap, configuración y base HTTP (Sonnet)

**Entregables:**

- `env.schema.ts` con Zod, configuración tipada, booleanos estrictos, errores legibles; `configuration.ts` mediante Nest ConfigModule y `.env.example` sincronizado.
- `app.setup.ts` reutilizado desde `main.ts` y tests e2e, sin prefijos inesperados; `GET /health` público.
- `CommonModule` como único módulo global; implementar `RequestContextMiddleware`, `RequestContextService`, interfaz `IRequestContext` y `@CurrentContext()`. El middleware inicializa ALS con `requestId`, `requestUrl`, `startedAt` y `countryCode` no confiable hasta su validación; `x-request-id` en la respuesta.
- `ApiKeyGuard` global para `x-api-key`, `@Public()` para health y comparación adecuada de secretos.
- `ResponseInterceptor` mínimo para éxitos, `TimeOutInterceptor` con propagación RxJS correcta y filtro global de excepciones seguro.
- Constantes Swagger generales y esquema de seguridad API key; documentación inicial de endpoints.
- Integración de `HttpModule` de NestJS como infraestructura compartida, sin lógica de REST Countries todavía.

**Pruebas:** entorno inválido impide iniciar, `/health` público, claves ausentes/incorrectas rechazadas, header de correlación, errores seguros, configuración `configureApp()` igual en runtime y e2e.

**Cierre:** build, typecheck, lint, formato y pruebas de etapa superados; no agregar CRUD de dominio adelantado.

**Commits sugeridos (humanos):** `feat: configure typed application bootstrap and security`; `test: cover HTTP security and request context` (combinar si forman una sola unidad verificable).

## 5. Etapa 2  Infraestructura de bases de datos y catálogo (Sonnet)

**Entregables:**

- `DatabaseModule`, ciclo de vida del cliente MongoDB nativo, tokens DI tipados y `MongoRepository<T>` mínimo; sin Mongoose ni CRUD innecesario.
- `DynamoDBClient` + `DynamoDBDocumentClient` de SDK AWS v3; `DynamoRepository<T>` mínimo y proveedores concretos. Script idempotente para tabla DynamoDB con llaves string `PK` y `SK`.
- `CountriesModule`, `CountryRepository`, índice único `{ code: 1 }`, seed con `$setOnInsert` para `CO`/`MX` (más países solo con aprobación).
- Verificación de conexiones, inicialización reproducible y documentación del entorno local.

**Pruebas:** seed ejecutado dos veces sin duplicados ni sobrescritura, índice único, consulta por país, cierre de clientes. Comprobar `CreateTable`/`DescribeTable` y persistencia real en DynamoDB Local.

**Cierre:** scripts funcionan en un entorno recién levantado con Docker; métodos de repositorio tipados; verificaciones aprobadas.

**Commit sugerido:** `feat: add database clients and idempotent country catalog`.

## 6. Etapa 3  Enriquecimiento REST Countries (Sonnet)

**Entregables:**

- `EnrichmentModule` y `RestCountriesService` con `HttpModule` o wrapper compartido solo si aporta valor.
- Esquema Zod para la respuesta necesaria y mapeo a `ICountryEnrichment`.
- Timeout explícito y clasificación de fallos de conexión, HTTP 4xx/5xx, respuestas vacías o inválidas.
- Nunca enviar nombre/documento en URL, headers o body del proveedor ni registrarlos en logs.
- Validar `x-country-code` en POST y su presencia/habilitación en la colección antes de llamar REST Countries.

**Pruebas:** CO/MX con mocks; código no permitido; timeout; servicio externo no disponible; respuesta malformada; ausencia de PII en la solicitud saliente.

**Cierre:** pruebas deterministas, sin depender de red real en unitarias; datos enriquecidos acotados y documentados.

**Commit sugerido:** `feat: integrate REST Countries geographic enrichment`.

## 7. Etapa 4  Lectura y creación atómica con outbox (Sonnet)

**Entregables:**

- DTO/esquemas Zod, `ValidationRepository`, `OutboxRepository` con operaciones mínimas, `ValidationsService` y controller delgado.
- `POST /validations`: país explícito, enriquecimiento y transacción que inserta validación y evento pendiente; generar `eventId` una sola vez.
- `GET /validations/:id`: `200` existente, `400` ID malformado, `404` inexistente; representación pública sin campos internos del outbox.
- `Idempotency-Key` **opcional (D-11)**: consultar replay antes de REST Countries; misma clave + misma huella devuelve el ID original con `201`; clave reutilizada con otra huella → `409`; sin clave, cada POST es una creación nueva. Usar índice único parcial y contemplar concurrencia y reintentos transaccionales.
- Mapear errores específicos sin envolver indiscriminadamente excepciones DB en `500`.

**Pruebas:** lecturas/escrituras, body e ID inválidos, reintento de misma operación, conflicto de fingerprint, rollback al fallar la inserción outbox y concurrencia/idempotencia.

**Cierre:** atomicidad comprobada contra replica set real, no únicamente mocks. En esta etapa el contrato de creación ya queda definido como `201` después del commit Mongo (D-10), pero **el requisito de auditoría en DynamoDB no estará completo hasta la Etapa 5**. No afirmar que hay entrega eventual real sin publicador y recuperación funcionando.

**Commit sugerido:** `feat: implement validation persistence and transactional outbox`.

## 8. Etapa 5  Publicador de auditoría DynamoDB y recuperación (Sonnet + revisión Opus)

**Entregables:**

- `ValidationAuditRepository extends DynamoRepository<...>`; `PK = DOCUMENT#...` y `SK = fecha#eventId` con valores estables.
- Escritura condicional: mismo evento es replay válido después de comprobar identidad; una colisión distinta es error real.
- `AuditPublisher` procesa pendientes, escribe en DynamoDB y marca `PUBLISHED` al confirmar; soporta acknowledgements ambiguos.
- Mecanismo de recuperación al iniciar y periódico, reintentos con backoff y procesamiento por lote invocable desde tests. Para instancia única evitar leases salvo necesidad demostrada; el worker no depende del contexto ALS HTTP.
- **Aplicar D-10:** si el commit MongoDB fue exitoso, un fallo de DynamoDB mantiene `PENDING` y el POST retorna `201`, **no `503`**. El intento inline debe ser de mejor esfuerzo con timeout acotado; no provocar `504` tardío tras persistencia.

**Pruebas:** Dynamo Local exitoso; Dynamo caído después de commit Mongo → `201` y `PENDING`; worker recupera y publica tras restablecerse; replay de evento idéntico, colisión real, fallo al marcar `PUBLISHED` seguido de conciliación segura. Con `Idempotency-Key`, un replay HTTP usa el mismo ID y `201`; sin clave no hay deduplicación prometida. Verificar timeouts por dependencia y que no ocurra `504` por publicación tardía después de commit.

**Cierre:** fallos/recuperación e identidad de eventos comprobados con bases locales reales. Opus revisa corrección y consistencia antes de aprobar etapa.

**Commit sugerido:** `feat: implement idempotent DynamoDB audit delivery and recovery`.

## 9. Etapa 6  Verificación integral, seguridad y documentación (Sonnet + revisión Opus)

**Entregables:**

- Tests e2e Supertest reutilizando `configureApp()`; integración con Docker donde corresponda.
- Swagger preciso: headers, esquemas, respuestas, errores, health y protección real mediante guard.
- README reproducible: versiones, Docker/replica set, permisos de volumen DynamoDB, `.env`, inicialización de tabla/índices/seed, endpoints Windows versus Docker, ejecución, tests, Swagger, ejemplos `curl` y resolución de problemas.
- Tres explicaciones obligatorias: uso real de IA y correcciones, justificación de PK/SK, mejoras futuras; basarse en evidencia de `04-ai-usage.md`.
- Revisión final con Opus de seguridad, contratos, garantías de outbox, idempotencia y complejidad innecesaria. Resolver observaciones aprobadas.

**Cierre:** proceso desde clon limpio documentado y reproducible; suite, tipos, lint y build exitosos; sin secretos/PII. Los dos endpoints originales y la auditoría se pueden verificar sin pasos manuales ocultos.

**Commits sugeridos:** `test: add end-to-end and failure-recovery coverage`; `docs: finalize setup and architectural decisions`.

## 10. Controles de calidad en cada etapa

Utilizar los scripts **reales** de `package.json`; configurar los que falten antes de declarar que pasaron:

```bash
npm run typecheck
npm run lint:check
npm run format:check
npm run build
npm run test
```

Ejecutar integración por separado, con Docker disponible y limpieza de fixtures. Claude puede consultar `git diff` y `git status` **solo en lectura**. **Nunca** debe ejecutar `git add`, `git commit`, `git push`, cambios de rama, `reset`, `merge` ni otras escrituras Git.

Al cerrar cada etapa, Sonnet reportará:

1. Archivos creados/modificados y por qué.
2. Criterios de aceptación cubiertos.
3. Comandos ejecutados y resultados efectivamente observados.
4. Limitaciones, riesgos y decisiones pendientes.
5. Mensaje Conventional Commit sugerido en inglés, **sin ejecutarlo**.

## 11. Prioridades y control de alcance

**Primero, lo exigido por Auco:** dos endpoints, API pública, persistencia MongoDB, evento DynamoDB, validaciones, errores externos, pruebas y README. Desarrollar una ruta funcional completa, no una colección de clases de infraestructura sin uso.

**Mejoras propias aprobadas:** infraestructura genérica mínima, países, API key, health, Swagger, correlación, outbox duradero e idempotencia. Limitar helpers y módulos a casos reales.

**Solo futuro:** verificación de identidad, biometría y fraude, autorización multicliente, despliegue cloud AWS, observabilidad avanzada, distribución multirregión, frontend.

Si la complejidad crece inesperadamente, revisar alcance con la persona desarrolladora, sin omitir requisitos de Auco ni garantías de auditoría aprobadas.

## 12. Decisiones que Opus debe cerrar

| Decisión | Resolver antes de |
| --- | --- |
| **D-10 aprobada:** `201` tras commit Mongo + outbox; auditoría eventual | Aplicar en etapas 4–5; no pendiente |
| **D-11 aprobada:** `Idempotency-Key` opcional | Aplicar en etapa 4; no pendiente |
| `x-country-code` en GET (recomendado: no) | Etapas 1–4 |
| Recuperación del outbox en entorno local | Etapa 5 |
| Envoltorio final y códigos de validación | Etapas 1 y 4 |
| Endpoint y esquema vigentes REST Countries | Etapa 3 |

## 13. Flujo Git exclusivamente humano

- Revisar `git diff`, inspeccionar archivos nuevos y ejecutar los controles tras cada etapa.
- Crear commit por **unidad funcional completa y verificable**, incluyendo tests asociados.
- Nunca subir `.env`, secretos reales, datos de clientes, volúmenes Mongo/Dynamo, `node_modules` ni artefactos compilados.
- Mantener historial claro; push y PR son responsabilidad humana.

**Commit de documentación sugerido tras aprobación:** `docs: adopt eventual audit delivery and optional request idempotency`.
