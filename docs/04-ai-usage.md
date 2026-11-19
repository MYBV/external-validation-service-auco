# 04 Registro de uso de IA y revisión humana

**Proyecto:** `external-validation-service-auco`  
**Propósito:** Llevar un registro verificable para responder a la pregunta de Auco.ai: *«¿Cómo usaste la IA, qué le pediste y qué tuviste que corregir?»*  
**Estado:** Documento vivo. No inventar implementaciones, revisiones, fallos ni pruebas que todavía no ocurrieron.

## 1. Principios

- La persona desarrolladora es responsable de la solución, la aprobación de decisiones de arquitectura, tratamiento de datos, verificación de pruebas y control de Git.
- Claude Opus realizó **dos revisiones arquitectónicas, la Etapa 0.5 y la revisión independiente de la Etapa 5**; Claude Sonnet realizó **la implementación y las correcciones de las Etapas 1 a 6**.
- Evaluar las sugerencias relevantes de IA contra [`01-requirements.md`](./01-requirements.md) y [`02-architecture.md`](./02-architecture.md).
- Registrar correcciones sustanciales, especialmente en consistencia, seguridad, minimización de datos y errores. No incluir contraseñas, API keys, solicitudes completas con nombres/documentos ni correos privados.
- Claude no realiza escrituras Git (`add`, `commit`, `push`, `reset`, cambios de rama).
- Una prueba sugerida por IA solo está «verificada» si se ejecutó y se observó su resultado.

## 2. Decisiones iniciales anteriores a Claude

La persona desarrolladora tomó las siguientes decisiones **antes de las sesiones efectivamente realizadas con Claude Opus y Sonnet**:

| Tema | Decisión | Motivo |
| --- | --- | --- |
| Framework | NestJS 12, TypeScript estricto, ESM nativo | Base moderna y tipada. |
| Pruebas | Vitest y Supertest para e2e | Verificación automatizada de comportamiento HTTP. |
| Enriquecimiento | REST Countries, descartando Frankfurter | Más relacionado con contexto geográfico, sin fingir verificación de identidad. |
| País | Header `x-country-code`, catálogo Mongo `countries` y seed | Elección explícita, sin inferir país del documento. |
| Bases de datos | MongoDB nativo y SDK AWS v3 Document Client | Implementar los motores pedidos sin ORM innecesario. |
| Repositorios | Bases genéricas mínimas y separadas | Evitar CRUD y abstracciones sin uso. |
| Consistencia | Transacción Mongo + outbox pendiente + escritura condicional/recuperación DynamoDB | Evitar eventos perdidos y replays duplicados. |
| Seguridad | API key en validaciones, health público, Swagger security | Contrato HTTP protegido y verificable. |
| Contexto | ALS con requestId, requestUrl, startedAt, countryCode | Correlación sin registrar PII. |
| Configuración HTTP | `app.setup.ts`, Zod entorno, filtro seguro, interceptor timeout y respuesta exitosa | Pipeline común para runtime/e2e y errores predecibles. |
| Identidad | Posible extensión futura, no implementación actual | Inputs insuficientes, fuentes confiables limitadas y control de alcance. |
| Git | Solo la persona desarrolladora hace commits y push | Revisión humana y trazabilidad. |

**Nota:** esta tabla registra decisiones de diseño, no afirma que esas funcionalidades ya estén implementadas ni probadas.

## 3. Plantilla de bitácora por sesión de Claude

Copiar esta plantilla para cada revisión importante de Opus o etapa de implementación con Sonnet; completar solo con hechos, fechas y evidencia reales.

### Sesión [ID] [fecha] [modelo] [etapa]

- **Objetivo / resumen del prompt:** [¿Qué se pidió?]
- **Archivos revisados o modificados:** [Rutas]
- **Propuestas o resultados de IA:** [Descripción breve y específica]
- **Decisiones humanas:** [Qué se aceptó/rechazó y por qué]
- **Correcciones necesarias:** [Error, contradicción o problema real; comportamiento anterior y posterior]
- **Verificación realizada:** [Comandos ejecutados y resultados observados]
- **Riesgos pendientes:** [Si existen]
- **Commit Git:** [Hash/mensaje creado por la persona desarrolladora, nunca por Claude]

> No presentar plantillas sin completar como trabajo realizado.

## 4. Historial de sesiones y puntos de control

| Etapa | Actividad prevista para IA | Correcciones y verificaciones reales |
| --- | --- | --- |
| Primera revisión de arquitectura (Opus) | Revisión crítica de `docs/`, reglas y configuración. | **Realizada**: identificó riesgos de `503` + idempotencia opcional, replica set, tooling, reglas, timeouts y recuperación outbox. Informe generado en `.claude/plans/`. |
| Segunda revisión de arquitectura (Opus) | Revisión incremental tras ajustes de documentación/reglas. | **Realizada**: verificó D-10/D-11, `RequestContextMiddleware`, nuevas decisiones D-04 y D-14–D-16, problemas de frontmatter y herramientas. |
| Etapa 0.5 (Opus) | Saneamiento del entorno inicialmente previsto para Sonnet, ejecutado por Opus. | **Realizada**: scripts y ESLint/Vitest, configuración de Docker Compose y `.env.example`, reglas y documentación. Controles reportados y commit/merge humanos. |
| Etapa 1: bootstrap y seguridad (Sonnet) | Configuración, app setup, API key, ALS, filtro/interceptors, Swagger, health y pruebas. | **Implementada y corregida**: 68 pruebas unitarias y 22 e2e reportadas por Sonnet; hallazgos I-1 a I-4 y O-1 a O-3 corregidos; commit humano `972a1c3` y merge `e025664`. |
| Bases/catálogo | Sonnet desarrolla proveedores Mongo/AWS, repositorios y seed de países. | **Implementado (Etapa 3, pendiente de revisión/commit humano)**: catálogo `countries`, índice único y seed `CO`/`MX` integrados en `infra:init`; seed repetido sin cambios verificado en integración real. |
| Enriquecimiento | Sonnet integra REST Countries con Zod y timeouts. | **Implementado con mocks (Etapa 3)**: no se probó contra el proveedor con clave real; la clave demo solo sirvió para inspeccionar la forma de la respuesta. Corrección detectada al verificar la documentación: el campo es `capitals` y un código sin coincidencia devuelve `200` con `objects` vacío. |
| Validaciones/outbox (Etapa 4) | Sonnet implementa transacción atómica e idempotencia HTTP. | **Implementada (pendiente de revisión/commit humano).** Plan presentado y corregido antes de implementar: la persona desarrolladora exigió HMAC-SHA256 con un secreto independiente (`IDEMPOTENCY_HASH_SECRET`) en lugar de SHA-256 simple, y una estrategia acotada para `E11000`, `WriteConflict`, errores transitorios, ganador no visible y resultado incierto, sin convertir errores arbitrarios de MongoDB en replays. Discrepancias documentales corregidas en `docs/` (D-04, D-16, D-17, esquema de `validations`/outbox). Corrección propia durante la implementación: el `trim` de Zod elimina un salto de línea final, por lo que ese caso no es un body inválido. Verificación ejecutada: `typecheck`, `lint:check`, `format:check`, `build`, `test`, `test:e2e` y `test:integration` (MongoDB real, incluida la concurrencia) pasaron, y `infra:init` se ejecutó dos veces sin errores. Revisión posterior solicitada por la persona desarrolladora: se comprobó en el código y los tipos del driver 7.9.0 que `timeoutMS` de `withTransaction()` no tiene efecto; se añadió `maxCommitTimeMS` y la reconciliación de un commit incierto también sin clave, y una prueba real con un límite de 1 ms mostró que un commit expirado puede haberse persistido. Se corrigió además el OpenAPI (faltaba el parámetro `id` de GET; se añadieron patrones de los headers y el cuerpo común de errores) con un e2e que inspecciona el documento generado. Quedan fuera de esta etapa la publicación en DynamoDB y la recuperación del outbox. |
| Auditoría | Sonnet implementa escritura condicional y recuperación; Opus revisa. | **Pendiente** |
| Verificación final | Sonnet prepara e2e/README; Opus revisa riesgos finales. | **Pendiente** |

## 5. Tipos de correcciones que conviene registrar si realmente ocurren

- Suponer que REST Countries verifica una identidad.
- Enviar por accidente `name`/`documentNumber` al proveedor o mostrarlos en logs.
- Permitir pasar el guard sin API key, o documentar seguridad únicamente en Swagger sin exigirla.
- Usar tipos inseguros o no validar respuestas externas.
- Configurar erróneamente el host del replica set o permisos del volumen DynamoDB Local.
- Duplicar auditorías si DynamoDB confirma la escritura pero falla la respuesta.
- Guardar Mongo correctamente y fallar Dynamo sin semántica segura de `201`/`503`.
- No recuperar eventos outbox pendientes tras reinicio.
- Envolver errores únicos/condicionales de base de datos en errores genéricos que ocultan la causa.
- Usar exclusivamente mocks para una prueba que afirma comprobar consistencia real entre bases.

**No afirmar que estas correcciones ocurrieron sin diffs, tests u otra evidencia.**

## 6. Respuesta final solicitada por Auco borrador sin completar

La respuesta final debe ser **un solo párrafo fiel a lo que se hizo**, no una afirmación genérica de que la IA construyó todo el servicio. Actualizar después de desarrollar, usando ejemplos concretos de §3.

> Utilicé Claude como asistente para revisar requisitos y arquitectura, implementar componentes acotados y proponer pruebas. Revisé sus resultados y realicé ajustes en [corrección concreta 1] y [corrección concreta 2], verificándolos mediante [pruebas realmente ejecutadas]. Las decisiones de diseño y la validación final de la solución fueron responsabilidad mía.

**Este párrafo es una plantilla**, no la versión final. Sustituir corchetes solo con hechos verificados.

## 7. Lista final de evidencias

- [ ] El párrafo de IA describe las herramientas/modelos realmente utilizados, cuando sea relevante.
- [ ] Se documentó al menos una propuesta real de IA y una corrección humana sustancial y verificable.
- [ ] Las afirmaciones sobre tests corresponden a ejecuciones reales; se informan fallos o limitaciones.
- [ ] README y arquitectura no exageran garantías entre bases ni afirman verificación de identidad.
- [ ] La bitácora no contiene información sensible.
- [ ] La persona desarrolladora revisó los cambios finales y realizó manualmente los commits.


## 8. Registro factual de sesiones completadas (18/11/2026)

### Sesión A Primera revisión arquitectónica Claude Opus

- **Solicitud:** revisar en solo lectura requisitos, arquitectura, reglas de Claude, Docker y configuración; entregar hallazgos por criticidad.
- **Resultado reportado:** problemas de entorno/quality gates y la incompatibilidad práctica entre `503` tras commit y `Idempotency-Key` opcional.
- **Decisión humana:** aprobar D-10 (`201` tras commit Mongo y outbox con auditoría eventual) y D-11 (idempotencia de solicitud opcional); la elección se justificó como decisión propia, no como una exigencia de Auco.
- **Evidencia:** informe `pasted-content-id-95e6-act-a-como-polymorphic-perlis.md` en planes de Claude. No se implementó código en esta revisión.

### Sesión B Segunda revisión arquitectónica Claude Opus

- **Solicitud:** reexaminar estado del repositorio tras cambios en `docs/`, `CLAUDE.md` y reubicación de reglas.
- **Resultado reportado:** confirmación de D-10/D-11 y decisiones D-04 (`x-country-code` solo POST), D-14 (país de ALS solo correlación), D-15 (almacenamiento ALS único), D-16 (envoltorio `{ data }` y mapper de dominio); halló problemas de frontmatter, scripts, `.env.example` y duplicación de tests por worktrees.
- **Decisión humana:** aprobar Etapa 0.5 y su alcance, manteniendo operaciones Git bajo control de la persona desarrolladora.
- **Evidencia:** plan `pasted-content-id-1c39-1er-prompt-witty-summit.md` actualizado en Claude.

### Sesión C Etapa 0.5 ejecutada por Claude Opus

- **Desviación de plan:** se esperaba que Sonnet la ejecutara, pero Opus informó que **él mismo** la ejecutó; registrar el modelo real.
- **Cambios reportados:** frontmatter y glob `paths` de `.claude/rules`, `.env.example` versionable y puertos corregidos, healthcheck Mongo con replica set, versión fija de imágenes, scripts de calidad, exclusión de worktrees en Vitest, ESLint estricto y TypeScript build.
- **Verificación reportada por Opus:** typecheck, lint, format, build, tests y e2e; Mongo PRIMARY con commit/rollback desde un contenedor y persistencia DynamoDB Local tras reinicio.
- **Limitaciones:** no se verificó el `rs.initiate` sobre volumen completamente vacío ni una transacción ejecutada directamente desde un proceso Windows.
- **Git humano:** commits `64af965` y `9d141f4`, merge `5873551` en `main`. Posteriormente se hizo una corrección de formato con Prettier; el hash exacto de ese commit no se facilitó aquí.

### Sesión D Etapa 1 y revisión correctiva Claude Sonnet

- **Implementación inicial:** Zod, `@nestjs/config`, `@nestjs/swagger`, ALS, guard API key, filtro, interceptores, `/health`, Swagger y e2e, sin integrar Mongo ni Dynamo todavía.
- **Revisión y correcciones humanas solicitadas:** I-1 restringir errores 4xx genéricos en el filtro; I-2 prueba concurrente e2e de ALS; I-3 restaurar `process.env` clave por clave; I-4 compartir opciones `ConfigModule`. Además, O-1 excluir query strings, O-2 deshabilitar `X-Powered-By`, O-3 tolerar `headersSent`.
- **Verificación reportada por Sonnet tras corregir:** `npm run typecheck`, `lint:check`, `format:check`, `build`, `test` (**68 pruebas en 8 archivos**) y `test:e2e` (**22 pruebas en 2 archivos**) pasaron. Distinguir de ejecuciones posteriores hechas desde `main`.
- **Git humano:** commit `972a1c3` (`feat: implement application foundation, security and request context`) y merge `e025664` a `main`.
- **Pendientes:** persistencia, integración REST Countries v5 y auditoría; la suite completa desde `main` deberá quedar registrada con resultados realmente observados.

### Investigación pública posterior REST Countries v5

- **Motivo:** la persona desarrolladora detectó que la API elegida aparentemente requería credenciales.
- **Confirmación en documentación oficial:** https://restcountries.com/docs y https://restcountries.com/docs/countries v5 con bearer API key, nueva ruta `/countries/v5/codes.alpha_2/{CODE}` y resultados `data.objects`.
- **Impacto:** actualizar requisitos/arquitectura/plan para Etapa 3, sin afirmar todavía que exista una clave real ni que la integración esté probada.
- **No confundir:** `rc_live_demo` es una muestra de demostración, no sustituye una credencial real.

### Sesión E Etapa 5 auditoría DynamoDB y recuperación Claude Sonnet

- **Proceso:** primero se presentó un plan (sin modificar archivos); la persona desarrolladora lo revisó dos veces y pidió ajustes antes de aprobar: re-inspección tras sincronizar el worktree con `main`, cobertura de todos los caminos de creación confirmada (incluido `UnknownTransactionCommitResult`), presupuesto inline que cubra la operación completa y fencing de operaciones tardías, una comparación explícita de opciones de PK, y una prueba de recuperación real con caída de DynamoDB.
- **Decisiones humanas:** D-21 (PK `DOCUMENT#<país>#<documento>`, que revisa D-09; HMAC de la PK queda como mejora futura) y aprobación de D-22 a D-25 (lease en `nextAttemptAt` con `claimToken`, `FAILED` para errores permanentes, errores transitorios nunca terminales, inline de 1500 ms sin circuit breaker).
- **Implementación de Claude:** `AuditModule` (`ValidationAuditRepository`, `AuditPublisher`, `AuditRecoveryWorker`), claim/mark en `OutboxRepository`, `abortSignal` opcional en `DynamoRepository`, variables `AUDIT_*`, integración en `ValidationsService` y utilidades de prueba (`tcp-proxy`, `wait-for`). Las operaciones Git las realiza exclusivamente la persona desarrolladora.
- **Correcciones durante la implementación:** el temporizador de apagado del worker usaba `node:timers/promises`, que los temporizadores falsos de Vitest no controlan; se sustituyó por `setTimeout`/`clearTimeout`. Se corrigieron además errores de tipos y de ESLint en las pruebas nuevas. El primer intento de actualizar documentación con un script embebido en el shell falló por citado y se rehízo con un script en archivo.
- **Verificación ejecutada por Claude (19/11/2026):** typecheck, lint, format, build, 315 pruebas unitarias, 68 e2e, 61 de integración (MongoDB replica set y DynamoDB Local reales) e `infra:init` dos veces; resultados y limitaciones detallados en `03-development-plan.md` §8. Pendiente: revisión humana y de Opus.

### Sesión F Correcciones de la revisión independiente de la Etapa 5 Claude Sonnet

- **Origen:** revisión independiente de Opus (apto con ajustes menores, sin hallazgos críticos ni altos). La persona desarrolladora pidió corregir M-1, M-2 y M-4, evaluar una mitigación mínima para M-3 y ajustar backoff y validación del lease.
- **Cambios de Claude:** `ValidationException` pasa a error transitorio (M-1); presupuesto inline según `startedAt` de la solicitud, con margen y omisión (M-2); detección de ciclo bloqueado del worker, sin liberar referencias, tras revisar los tipos del driver 7.9.0 (M-3); modo `blackhole` en `TcpProxy` y pruebas de integración reales con DynamoDB que acepta y no responde (M-4); backoff desde el momento del fallo y lease frente a `8 × DYNAMODB_TIMEOUT_MS`.
- **Hallazgo propio durante las pruebas:** una prueba de integración nueva falló porque la aplicación con worker de una prueba anterior seguía abierta y publicaba los eventos de la siguiente; se corrigió cerrando las aplicaciones creadas por cada prueba. No fue un defecto del producto.
- **Verificación ejecutada por Claude (19/11/2026):** typecheck, lint, format, build, 327 pruebas unitarias, 68 e2e, 64 de integración (tres ejecuciones seguidas) e `infra:init` dos veces; una comprobación por mutación confirmó que las pruebas de presupuesto detectan la ausencia de la protección. Pendiente: revisión humana.

**Importante:** el registro distingue los resultados **comunicados por Claude** de pruebas reproducidas personalmente. Completar manualmente con resultados de `main` y correcciones adicionales si ocurren.

### Sesión G Etapa 6 verificación integral y documentación final Claude Sonnet

- **Proceso:** se presentó primero un plan sin modificar archivos; la persona desarrolladora lo aprobó con ajustes (README en español, script smoke opcional de REST Countries, inspección de DynamoDB con AWS CLI, `docs/05-delivery.md`, sin API key real ni uso de `rc_live_demo` como evidencia).
- **Cambios de Claude:** reescritura de `README.md` (era el boilerplate de NestJS), instrucciones de generación de secretos en `.env.example`, `scripts/smoke-rest-countries.mjs` con el script `smoke:rest-countries`, `docs/05-delivery.md` y actualización del estado de `docs/01` a `docs/04`. Sin cambios en `src/`, contratos HTTP ni dependencias.
- **Hallazgos propios:** el README no documentaba el proyecto; `infra:init` es un paso imprescindible (sin él todo POST devuelve `400`); los marcadores de `.env.example` superan la validación de longitud y permitirían arrancar con secretos de ejemplo; `test` y `test:e2e` funcionan sin `.env` y `test:integration` exige `.env` y Docker.
- **Verificación ejecutada (19/11/2026):** `npm ci`, typecheck, lint, format, build, 327 pruebas unitarias, 68 e2e, 64 de integración e `infra:init` dos veces; recorrido del README sobre recursos aislados con un proveedor REST Countries **simulado localmente**. La integración real con REST Countries **no se verificó** (sin clave). Detalle en `05-delivery.md`.
- **Pendiente:** revisión humana y de los borradores del formulario; Git exclusivamente humano.
