# 04  Registro de uso de IA y revisión humana

**Proyecto:** `external-validation-service-auco`  
**Propósito:** Llevar un registro verificable para responder a la pregunta de Auco.ai: _«¿Cómo usaste la IA, qué le pediste y qué tuviste que corregir?»_  
**Estado:** Documento vivo. No inventar implementaciones, revisiones, fallos ni pruebas que todavía no ocurrieron.

## 1. Principios

- La persona desarrolladora es responsable de la solución, la aprobación de decisiones de arquitectura, tratamiento de datos, verificación de pruebas y control de Git.
- Claude Opus es el **revisor de arquitectura previsto** y Claude Sonnet el **asistente de implementación incremental previsto**. Son roles planificados, no evidencia de trabajo ya efectuado.
- Evaluar las sugerencias relevantes de IA contra [`01-requirements.md`](./01-requirements.md) y [`02-architecture.md`](./02-architecture.md).
- Registrar correcciones sustanciales, especialmente en consistencia, seguridad, minimización de datos y errores. No incluir contraseñas, API keys, solicitudes completas con nombres/documentos ni correos privados.
- Claude no realiza escrituras Git (`add`, `commit`, `push`, `reset`, cambios de rama).
- Una prueba sugerida por IA solo está «verificada» si se ejecutó y se observó su resultado.

## 2. Decisiones iniciales anteriores a Claude

La persona desarrolladora tomó las siguientes decisiones **antes de las sesiones previstas con Claude Opus y Sonnet**:

| Tema               | Decisión                                                                            | Motivo                                                                         |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Framework          | NestJS 12, TypeScript estricto, ESM nativo                                          | Base moderna y tipada.                                                         |
| Pruebas            | Vitest y Supertest para e2e                                                         | Verificación automatizada de comportamiento HTTP.                              |
| Enriquecimiento    | REST Countries                                                                      | Más relacionado con contexto geográfico, sin fingir verificación de identidad. |
| País               | Header `x-country-code`, catálogo Mongo `countries` y seed                          | Elección explícita, sin inferir país del documento.                            |
| Bases de datos     | MongoDB nativo y SDK AWS v3 Document Client                                         | Implementar los motores pedidos sin ORM innecesario.                           |
| Repositorios       | Bases genéricas mínimas y separadas                                                 | Evitar CRUD y abstracciones sin uso.                                           |
| Consistencia       | Transacción Mongo + outbox pendiente + escritura condicional/recuperación DynamoDB  | Evitar eventos perdidos y replays duplicados.                                  |
| Seguridad          | API key en validaciones, health público, Swagger security                           | Contrato HTTP protegido y verificable.                                         |
| Contexto           | ALS con requestId, requestUrl, startedAt, countryCode                               | Correlación sin registrar PII.                                                 |
| Configuración HTTP | `app.setup.ts`, Zod entorno, filtro seguro, interceptor timeout y respuesta exitosa | Pipeline común para runtime/e2e y errores predecibles.                         |
| Identidad          | Posible extensión futura, no implementación actual                                  | Inputs insuficientes, fuentes confiables limitadas y control de alcance.       |
| Git                | Solo la persona desarrolladora hace commits y push                                  | Revisión humana y trazabilidad.                                                |

**Nota:** esta tabla registra decisiones de diseño, no afirma que esas funcionalidades ya estén implementadas ni probadas.

## 3. Plantilla de bitácora por sesión de Claude

Copiar esta plantilla para cada revisión importante de Opus o etapa de implementación con Sonnet; completar solo con hechos, fechas y evidencia reales.

### Sesión [ID]  [fecha]  [modelo]  [etapa]

- **Objetivo / resumen del prompt:** [¿Qué se pidió?]
- **Archivos revisados o modificados:** [Rutas]
- **Propuestas o resultados de IA:** [Descripción breve y específica]
- **Decisiones humanas:** [Qué se aceptó/rechazó y por qué]
- **Correcciones necesarias:** [Error, contradicción o problema real; comportamiento anterior y posterior]
- **Verificación realizada:** [Comandos ejecutados y resultados observados]
- **Riesgos pendientes:** [Si existen]
- **Commit Git:** [Hash/mensaje creado por la persona desarrolladora, nunca por Claude]

> No presentar plantillas sin completar como trabajo realizado.

## 4. Puntos de control previstos (aún no realizados)

| Etapa                 | Actividad prevista para IA                                                        | Correcciones y verificaciones reales |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| Arquitectura          | Opus analiza requisitos, headers extra, consistencia de bases y complejidad.      | **Pendiente**                        |
| Bootstrap y seguridad | Sonnet crea configuración, app setup, API key, ALS, filtro/interceptors, Swagger. | **Pendiente**                        |
| Bases/catálogo        | Sonnet desarrolla proveedores Mongo/AWS, repositorios y seed de países.           | **Pendiente**                        |
| Enriquecimiento       | Sonnet integra REST Countries con Zod y timeouts.                                 | **Pendiente**                        |
| Validaciones/outbox   | Sonnet implementa transacción atómica e idempotencia HTTP.                        | **Pendiente**                        |
| Auditoría             | Sonnet implementa escritura condicional y recuperación; Opus revisa.              | **Pendiente**                        |
| Verificación final    | Sonnet prepara e2e/README; Opus revisa riesgos finales.                           | **Pendiente**                        |

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

## 6. Respuesta final solicitada por Auco  borrador sin completar

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
