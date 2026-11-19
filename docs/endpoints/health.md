# Endpoints: Health y Swagger

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Resumen de Endpoints

| Método | URL | Autenticación | Descripción |
| --- | --- | --- | --- |
| `GET` | `/health` | Pública | Liveness básico del proceso HTTP |
| `GET` | `/docs` | Pública | Swagger UI, solo con `SWAGGER_ENABLED=true` |

---

## GET /health

### Descripción General

Indica que el proceso HTTP está operativo. Es un **liveness** básico: no consulta MongoDB, DynamoDB ni REST Countries, y no revela hosts, credenciales ni topología.

### Información del Endpoint

| Campo | Valor |
| --- | --- |
| **Método** | `GET` |
| **URL** | `/health` |
| **Autenticación** | No requiere `x-api-key` (`@Public()`) |
| **Controller** | `src/health/health.controller.ts` |

### Ejemplo de Request

```bash
curl -i http://localhost:3300/health
```

### Respuesta Exitosa

```json
{ "data": { "status": "ok" } }
```

### Limitaciones

Un `200` en `/health` no garantiza que las dependencias estén disponibles. Un chequeo de *readiness* (MongoDB, edad del último ciclo del worker de auditoría) queda como mejora futura.

---

## GET /docs (Swagger UI)

| Aspecto | Valor |
| --- | --- |
| Activación | `SWAGGER_ENABLED=true` (por defecto `false`; `.env.example` lo activa) |
| Ruta | `/docs` |
| Seguridad documentada | Esquema `api-key` sobre el header `x-api-key` (botón **Authorize**) |
| Metadata general | `src/swagger-conf.ts` |
| Metadata por módulo | `src/validations/swagger/validations.swagger.ts`, `src/health/swagger/health.swagger.ts` |

Swagger **documenta** la seguridad; quien **protege** las rutas es `ApiKeyGuard`. En producción se recomienda deshabilitarlo o protegerlo. Una prueba e2e inspecciona el documento OpenAPI generado (`test/swagger.e2e-spec.ts`).
