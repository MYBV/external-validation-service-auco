# 03 — Plan de desarrollo incremental

**Proyecto:** `external-validation-service-auco`  
**Estado:** Plan propuesto; ejecutar después de la revisión con Opus y aprobación de la persona desarrolladora  
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

## 3. Etapa 0 — Revisión y aprobación de requisitos y arquitectura (Opus)

**Entradas:** `01-requirements.md`, `02-architecture.md`, este plan, `CLAUDE.md` y el repositorio real.

**Tareas:**

1. Trazar cada requisito original de Auco hacia el comportamiento y la prueba correspondientes.
2. Examinar las extensiones de contrato (`x-api-key`, `x-country-code`, `Idempotency-Key`).
3. Resolver qué sucede si Mongo confirma pero Dynamo falla: recomendación provisional `503` con outbox pendiente; alternativa `201` con consistencia eventual.
4. Definir obligatoriedad de `Idempotency-Key`, replay y alcance del header país en GET (recomendación: solo POST).
5. Seleccionar la implementación mínima para publicación/recuperación del outbox y protección ante concurrencia, evitando infraestructura innecesaria.
6. Confirmar compatibilidad actual de NestJS 12, Zod/Standard Schema, TypeScript 6, `HttpModule`, MongoDB driver y SDK AWS.
7. Presentar cambios justificados. Solo modificar documentos tras aprobación humana.

**Criterio de cierre:** no existen decisiones críticas abiertas que bloqueen la implementación; registro de decisiones actualizado.

## 4. Etapa 1 — Bootstrap, configuración y base HTTP (Sonnet)

**Entregables:**

- `env.schema.ts` con Zod, configuración tipada, booleanos estrictos, errores legibles; `configuration.ts` mediante Nest ConfigModule y `.env.example` sincronizado.
- `app.setup.ts` reutilizado desde `main.ts` y tests e2e, sin prefijos inesperados; `GET /health` público.
- `CommonModule` como único módulo global; middleware ALS con `requestId`, `requestUrl`, `startedAt`, `countryCode`; `@CurrentContext()`.
- `ApiKeyGuard` global para `x-api-key`, `@Public()` para health y comparación adecuada de secretos.
- `ResponseInterceptor` mínimo para éxitos, `TimeOutInterceptor` con propagación RxJS correcta y filtro global de excepciones seguro.
- Constantes Swagger generales y esquema de seguridad API key; documentación inicial de endpoints.
- Integración de `HttpModule` de NestJS como infraestructura compartida, sin lógica de REST Countries todavía.

**Pruebas:** entorno inválido impide iniciar, `/health` público, claves ausentes/incorrectas rechazadas, header de correlación, errores seguros, configuración `configureApp()` igual en runtime y e2e.

**Cierre:** build, typecheck, lint, formato y pruebas de etapa superados; no agregar CRUD de dominio adelantado.

## 5. Etapa 2 — Infraestructura de bases de datos y catálogo (Sonnet)

**Entregables:**

- `DatabaseModule`, ciclo de vida del cliente MongoDB nativo, tokens DI tipados y `MongoRepository<T>` mínimo; sin Mongoose ni CRUD innecesario.
- `DynamoDBClient` + `DynamoDBDocumentClient` de SDK AWS v3; `DynamoRepository<T>` mínimo y proveedores concretos. Script idempotente para tabla DynamoDB con llaves string `PK` y `SK`.
- `CountriesModule`, `CountryRepository`, índice único `{ code: 1 }`, seed con `$setOnInsert` para `CO`/`MX` (más países solo con aprobación).
- Verificación de conexiones, inicialización reproducible y documentación del entorno local.

**Pruebas:** seed ejecutado dos veces sin duplicados ni sobrescritura, índice único, consulta por país, cierre de clientes. Comprobar `CreateTable`/`DescribeTable` y persistencia real en DynamoDB Local.

**Cierre:** scripts funcionan en un entorno recién levantado con Docker; métodos de repositorio tipados; verificaciones aprobadas.

## 6. Etapa 3 — Enriquecimiento REST Countries (Sonnet)

**Entregables:**

- `EnrichmentModule` y `RestCountriesService` con `HttpModule` o wrapper compartido solo si aporta valor.
- Esquema Zod para la respuesta necesaria y mapeo a `ICountryEnrichment`.
- Timeout explícito y clasificación de fallos de conexión, HTTP 4xx/5xx, respuestas vacías o inválidas.
- Nunca enviar nombre/documento en URL, headers o body del proveedor ni registrarlos en logs.
- Validar `x-country-code` en POST y su presencia/habilitación en la colección antes de llamar REST Countries.

**Pruebas:** CO/MX con mocks; código no permitido; timeout; servicio externo no disponible; respuesta malformada; ausencia de PII en la solicitud saliente.

**Cierre:** pruebas deterministas, sin depender de red real en unitarias; datos enriquecidos acotados y documentados.

## 7. Etapa 4 — Lectura y creación atómica con outbox (Sonnet)

**Entregables:**

- DTO/esquemas Zod, `ValidationRepository`, `OutboxRepository` con operaciones mínimas, `ValidationsService` y controller delgado.
- `POST /validations`: país explícito, enriquecimiento y transacción que inserta validación y evento pendiente; generar `eventId` una sola vez.
- `GET /validations/:id`: `200` existente, `400` ID malformado, `404` inexistente; representación pública sin campos internos del outbox.
- Clave única de idempotencia HTTP y fingerprint: mismo contenido recupera la operación, contenido distinto retorna `409`. Determinar obligatoriedad según etapa 0.
- Mapear errores específicos sin envolver indiscriminadamente excepciones DB en `500`.

**Pruebas:** lecturas/escrituras, body e ID inválidos, reintento de misma operación, conflicto de fingerprint, rollback al fallar la inserción outbox y concurrencia/idempotencia.

**Cierre:** atomicidad comprobada contra replica set real, no únicamente mocks. El `201` definitivo puede depender de etapa 5; no declarar aún cumplimiento total de la prueba.

## 8. Etapa 5 — Publicador de auditoría DynamoDB y recuperación (Sonnet + revisión Opus)

**Entregables:**

- `ValidationAuditRepository extends DynamoRepository<...>`; `PK = DOCUMENT#...` y `SK = fecha#eventId` con valores estables.
- Escritura condicional: mismo evento es replay válido después de comprobar identidad; una colisión distinta es error real.
- `AuditPublisher` procesa pendientes, escribe en DynamoDB y marca `PUBLISHED` al confirmar; soporta acknowledgements ambiguos.
- Mecanismo de recuperación tras reinicio y reintentos con backoff. Si se implementan leases, probar concurrencia; alternativamente limitarse a un worker local efectivo y documentado.
- Aplicar contrato HTTP aprobado para fallo DynamoDB (provisional `503` con outbox pendiente).

**Pruebas:** Dynamo Local exitoso, replay idéntico, colisión real, outage conserva pendiente, recuperación publica una sola vez lógicamente, fallo al marcar `PUBLISHED` seguido de replay seguro, reintento HTTP tras `503` reutiliza registro. Códigos HTTP coherentes con documento.

**Cierre:** fallos/recuperación e identidad de eventos comprobados con bases locales reales. Opus revisa corrección y consistencia antes de aprobar etapa.

## 9. Etapa 6 — Verificación integral, seguridad y documentación (Sonnet + revisión Opus)

**Entregables:**

- Tests e2e Supertest reutilizando `configureApp()`; integración con Docker donde corresponda.
- Swagger preciso: headers, esquemas, respuestas, errores, health y protección real mediante guard.
- README reproducible: versiones, Docker/replica set, permisos de volumen DynamoDB, `.env`, inicialización de tabla/índices/seed, endpoints Windows versus Docker, ejecución, tests, Swagger, ejemplos `curl` y resolución de problemas.
- Tres explicaciones obligatorias: uso real de IA y correcciones, justificación de PK/SK, mejoras futuras; basarse en evidencia de `04-ai-usage.md`.
- Revisión final con Opus de seguridad, contratos, garantías de outbox, idempotencia y complejidad innecesaria. Resolver observaciones aprobadas.

**Cierre:** proceso desde clon limpio documentado y reproducible; suite, tipos, lint y build exitosos; sin secretos/PII. Los dos endpoints originales y la auditoría se pueden verificar sin pasos manuales ocultos.

## 10. Controles de calidad en cada etapa

Utilizar los scripts **reales** de `package.json`; configurar los que falten antes de declarar que pasaron:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test -- --run
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

| Decisión                                      | Resolver antes de |
| --------------------------------------------- | ----------------- |
| Fallo auditoría: `503` o `201`/`202` eventual | Etapas 4–5        |
| `Idempotency-Key` obligatorio u opcional      | Etapa 4           |
| `x-country-code` en GET (recomendado: no)     | Etapas 1–4        |
| Recuperación del outbox en entorno local      | Etapa 5           |
| Envoltorio final y códigos de validación      | Etapas 1 y 4      |
| Endpoint y esquema vigentes REST Countries    | Etapa 3           |

## 13. Flujo Git exclusivamente humano

- Revisar `git diff`, inspeccionar archivos nuevos y ejecutar los controles tras cada etapa.
- Crear commit por **unidad funcional completa y verificable**, incluyendo tests asociados.
- Nunca subir `.env`, secretos reales, datos de clientes, volúmenes Mongo/Dynamo, `node_modules` ni artefactos compilados.
- Mantener historial claro; push y PR son responsabilidad humana.

