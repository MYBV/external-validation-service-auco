# 04 Registro de uso de IA y revisión humana

**Proyecto:** `external-validation-service-auco`  
**Propósito:** Llevar un registro verificable para responder a la pregunta de Auco.ai: *«¿Cómo usaste la IA, qué le pediste y qué tuviste que corregir?»*  
**Estado:** Documento vivo. No inventar implementaciones, revisiones, fallos ni pruebas que todavía no ocurrieron.

## 1. Principios

- La persona desarrolladora es responsable de la solución, la aprobación de decisiones de arquitectura, tratamiento de datos, verificación de pruebas y control de Git.
- Claude Opus realizó **dos revisiones arquitectónicas y la Etapa 0.5**; Claude Sonnet realizó **la implementación y las correcciones de la Etapa 1**. Los trabajos posteriores son planificados, no ejecutados.
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
| Bases/catálogo | Sonnet desarrolla proveedores Mongo/AWS, repositorios y seed de países. | **Pendiente** |
| Enriquecimiento | Sonnet integra REST Countries con Zod y timeouts. | **Pendiente** |
| Validaciones/outbox | Sonnet implementa transacción atómica e idempotencia HTTP. | **Pendiente** |
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

**Importante:** el registro distingue los resultados **comunicados por Claude** de pruebas reproducidas personalmente. Completar manualmente con resultados de `main` y correcciones adicionales si ocurren.
