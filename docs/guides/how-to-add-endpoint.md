# Guía: Cómo agregar un nuevo endpoint

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Decisiones previas](#1-decisiones-previas)
2. [Estructura de carpetas del módulo](#2-estructura-de-carpetas-del-módulo)
3. [Paso 1 — Esquemas Zod](#paso-1--esquemas-zod)
4. [Paso 2 — Interfaces](#paso-2--interfaces)
5. [Paso 3 — Repositorio](#paso-3--repositorio)
6. [Paso 4 — Servicio](#paso-4--servicio)
7. [Paso 5 — Mapper](#paso-5--mapper)
8. [Paso 6 — Metadata de Swagger](#paso-6--metadata-de-swagger)
9. [Paso 7 — Controller](#paso-7--controller)
10. [Paso 8 — Módulo](#paso-8--módulo)
11. [Paso 9 — Pruebas](#paso-9--pruebas)
12. [Paso 10 — Documentación](#paso-10--documentación)
13. [Checklist final](#checklist-final)

---

Antes de empezar: leer `CLAUDE.md`, las reglas de `.claude/rules/` y la documentación aprobada de `docs/`. Si una decisión de diseño falta o es ambigua, plantear las alternativas antes de implementar; no ampliar el alcance en silencio.

---

## 1. Decisiones previas

### ¿El endpoint es público?

Por defecto **toda ruta exige `x-api-key`** (guard global). Solo se marca `@Public()` lo que de verdad deba ser público, como `/health`. Ver [`pipeline-http.md`](../infrastructure/pipeline-http.md#apikeyguard-y-public).

### ¿Qué persistencia usa?

| Necesidad | Infraestructura |
| --- | --- |
| Documentos de negocio, lecturas por ID, transacciones | MongoDB (`MongoModule`) |
| Registro inmutable consultado por llave de partición | DynamoDB (`DynamoModule`) |
| Escribir en ambas | **Nunca** en la misma operación: usar el patrón outbox ([`auditoria-outbox.md`](../infrastructure/auditoria-outbox.md)) |

### ¿Llama a un servicio externo?

Crear un servicio dedicado en su propio módulo (como `EnrichmentModule`), con `HttpModule` importado solo ahí, timeout explícito, validación Zod de la respuesta y errores traducidos a excepciones HTTP fijas. Nunca enviar datos personales que el proveedor no necesite. Ver [`enriquecimiento-rest-countries.md`](../infrastructure/enriquecimiento-rest-countries.md).

### ¿Crea recursos?

Si un cliente puede reintentar, evaluar `Idempotency-Key` ([`idempotencia.md`](../infrastructure/idempotencia.md)).

---

## 2. Estructura de carpetas del módulo

```
src/<módulo>/
├── <módulo>.module.ts
├── controllers/<módulo>.controller.ts
├── services/<módulo>.service.ts
├── repositories/<entidad>.repository.ts
├── interfaces/<entidad>.interface.ts
├── schemas/                 # esquemas Zod de entrada
├── mappers/                 # representación pública (lista blanca)
└── swagger/<módulo>.swagger.ts
```

Crear solo las carpetas que se usen; nada de scaffolding vacío. Convenciones: código, identificadores y respuestas en **inglés**; interfaces con prefijo `I`; `type` para uniones e inferencias de Zod; sin `any`; imports con extensión `.js` (ESM nativo).

---

## Paso 1 — Esquemas Zod

```typescript
// src/<módulo>/schemas/create-example.schema.ts
import { z } from 'zod';

export const createExampleSchema = z.strictObject({
  code: z.string().trim().min(1).max(32),
});

export type CreateExampleBody = z.infer<typeof createExampleSchema>;
```

- `z.strictObject` rechaza campos desconocidos.
- Mensajes personalizados en inglés y sin incluir el valor recibido.
- Para headers, un esquema `z.object` con los nombres en minúsculas (ver `create-validation-headers.schema.ts`).
- Para un ID de MongoDB, reutilizar el patrón de `validation-id.schema.ts` (regex + `transform` a `ObjectId`).

---

## Paso 2 — Interfaces

```typescript
// src/<módulo>/interfaces/example.interface.ts
export interface IExample {
  code: string;
  createdAt: Date;
}

export interface IExampleResponse {
  id: string;
  code: string;
  createdAt: Date;
}
```

---

## Paso 3 — Repositorio

```typescript
// src/<módulo>/repositories/example.repository.ts
@Injectable()
export class ExampleRepository extends MongoRepository<IExample> {
  protected override readonly indexes: readonly IndexDescription[] = [
    { key: { code: 1 }, name: 'code_unique', unique: true },
  ];

  constructor(mongo: MongoService) {
    super(mongo, 'examples');
  }

  findByCode(code: string): Promise<WithId<IExample> | null> {
    return this.findOne({ code });
  }
}
```

- La lógica de persistencia vive en el repositorio; las consultas de dominio, como métodos con nombre.
- **Registrar el repositorio en `initializeInfrastructure()`** para que `infra:init` cree sus índices.
- Detalle en [`mongodb-arquitectura.md`](../infrastructure/mongodb-arquitectura.md#cómo-crear-un-nuevo-repositorio).

---

## Paso 4 — Servicio

```typescript
// src/<módulo>/services/example.service.ts
export const EXAMPLE_NOT_FOUND_MESSAGE = 'Example not found';

@Injectable()
export class ExampleService {
  constructor(private readonly examples: ExampleRepository) {}

  async findById(id: ObjectId): Promise<IExampleResponse> {
    const example = await this.examples.findById(id);
    if (example === null) {
      throw new NotFoundException(EXAMPLE_NOT_FOUND_MESSAGE);
    }
    return toExampleResponse(example);
  }
}
```

Reglas:

- El servicio orquesta; el controller no contiene lógica de negocio.
- Los resultados de dominio conocidos se lanzan como `HttpException` con mensajes fijos en inglés, exportados como constantes (las pruebas los reutilizan).
- Los errores que el servicio **no** sabe interpretar se dejan propagar: el filtro global los convierte en `500` sin filtrar detalles. No envolver errores de base de datos en `InternalServerErrorException`.
- Nunca registrar datos personales ni secretos en logs; usar el `requestId` del contexto para correlación ([`request-context.md`](../infrastructure/request-context.md)).
- Configuración: inyectar `APP_CONFIG` y, si el módulo necesita variables propias, crear una función `require<Algo>Config()` que falle con un error legible (ver [`configuracion-arranque.md`](../infrastructure/configuracion-arranque.md#patrón-opcional-en-el-esquema-exigida-por-el-módulo)).

---

## Paso 5 — Mapper

```typescript
// src/<módulo>/mappers/example.mapper.ts
export function toExampleResponse(example: WithId<IExample>): IExampleResponse {
  return {
    id: example._id.toHexString(),
    code: example.code,
    createdAt: example.createdAt,
  };
}
```

Lista blanca explícita: un campo interno nuevo nunca se expone por accidente. El `ResponseInterceptor` envuelve el resultado en `{ data }`; el mapper no debe hacerlo.

---

## Paso 6 — Metadata de Swagger

```typescript
// src/<módulo>/swagger/example.swagger.ts
export const SWCONF_EXAMPLES = {
  tag: 'examples',
  get: {
    operation: { summary: 'Find an example by id' },
    params: { id: { name: 'id', description: '24-character hexadecimal id' } },
    okResponse: { description: 'Example found.' },
    notFound: { description: 'Example not found.' },
  },
};
```

La metadata vive en constantes por módulo para mantener el controller corto. Descripciones en inglés. Reutilizar el esquema de error de `validations.swagger.ts` si se documentan errores.

---

## Paso 7 — Controller

```typescript
// src/<módulo>/controllers/example.controller.ts
@ApiTags(SWCONF_EXAMPLES.tag)
@ApiSecurity(API_KEY_SECURITY_NAME)
@Controller('examples')
export class ExampleController {
  constructor(private readonly examples: ExampleService) {}

  @Get(':id')
  @ApiOperation(SWCONF_EXAMPLES.get.operation)
  @ApiParam(SWCONF_EXAMPLES.get.params.id)
  @ApiOkResponse(SWCONF_EXAMPLES.get.okResponse)
  @ApiNotFoundResponse(SWCONF_EXAMPLES.get.notFound)
  findById(
    @Param('id', new ZodValidationPipe(exampleIdSchema)) id: ObjectId,
  ): Promise<IExampleResponse> {
    return this.examples.findById(id);
  }
}
```

- Validar cada entrada con `new ZodValidationPipe(schema)`; para headers, `@RequestHeaders(new ZodValidationPipe(schema))`.
- `@ApiSecurity('api-key')` documenta la seguridad; el guard es quien protege.
- Sin prefijo ni versionado en la ruta.

---

## Paso 8 — Módulo

```typescript
// src/<módulo>/<módulo>.module.ts
@Module({
  imports: [MongoModule],
  controllers: [ExampleController],
  providers: [ExampleRepository, ExampleService],
})
export class ExampleModule {}
```

- **No** marcar el módulo como `@Global()`: solo `CommonModule` lo es.
- Importar explícitamente la infraestructura que use (`MongoModule`, `DynamoModule`, otros módulos de dominio).
- Registrar el módulo en `AppModule`.

---

## Paso 9 — Pruebas

| Tipo | Comando | Qué cubrir |
| --- | --- | --- |
| Unitarias (`*.spec.ts` junto al código) | `npm run test` | Servicio con dobles: casos felices, errores de dominio, errores que se propagan sin cambios |
| E2E (`test/*.e2e-spec.ts`) | `npm run test:e2e` | Con `createTestApp()` (usa el mismo `configureApp()`): códigos HTTP, contrato `{ data }`, `401` sin API key, `400` con entradas inválidas, errores sin datos sensibles |
| Integración (`test/integration/*.int-spec.ts`) | `npm run test:integration` | Contra MongoDB y DynamoDB Local reales, con recursos `ev_test_<uuid>`; índices, transacciones y concurrencia |

Reglas del proyecto (`.claude/rules/testing.md`): Vitest (no Jest), pruebas deterministas, sin red real en unitarias, no debilitar aserciones para que pasen y no declarar pruebas como aprobadas sin haberlas ejecutado.

Controles de calidad antes de entregar:

```bash
npm run typecheck && npm run lint:check && npm run format:check && npm run build
npm run test && npm run test:e2e
npm run test:integration   # con Docker levantado
```

---

## Paso 10 — Documentación

1. Crear o actualizar `docs/endpoints/<módulo>.md` con el formato de [`validations.md`](../endpoints/validations.md): resumen, headers, información del endpoint, parámetros, ejemplo, respuesta exitosa y errores.
2. Agregarlo a [`documentation-index.md`](../documentation-index.md).
3. Si cambia la infraestructura, actualizar el documento correspondiente de `docs/infrastructure/`.
4. Si cambia el README (ejemplos `curl`, variables), actualizarlo.

---

## Checklist final

- [ ] Esquemas Zod para body, headers y params; objetos estrictos.
- [ ] Ruta protegida por API key (o `@Public()` justificado).
- [ ] Servicio sin lógica en el controller; errores de dominio con mensajes fijos en inglés.
- [ ] Mapper con lista blanca.
- [ ] Repositorio registrado en `infra:init` si declara índices.
- [ ] Módulo no global, importado en `AppModule`.
- [ ] Metadata de Swagger en `swagger/`.
- [ ] Pruebas unitarias, e2e y, si toca bases de datos, de integración.
- [ ] Sin datos personales ni secretos en logs, respuestas o ejemplos.
- [ ] Documentación de `docs/` e índice actualizados.
- [ ] Commit propuesto en formato Conventional Commits; lo ejecuta la persona desarrolladora.
