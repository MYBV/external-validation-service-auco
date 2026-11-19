# Catálogo de Países y Header `x-country-code`

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Por qué un país explícito](#por-qué-un-país-explícito)
2. [Componentes](#componentes)
3. [Colección `countries`](#colección-countries)
4. [Seed idempotente](#seed-idempotente)
5. [Validación del país en el POST](#validación-del-país-en-el-post)
6. [Cómo habilitar, deshabilitar o agregar un país](#cómo-habilitar-deshabilitar-o-agregar-un-país)

---

## Por qué un país explícito

El enunciado solo pide `name` y `documentNumber`. Para enriquecer con datos geográficos hace falta un país, y deducirlo del número de documento sería poco fiable. Por eso el cliente lo envía explícitamente en el header **`x-country-code`** (extensión propia del contrato, A-05):

- Obligatorio **solo** en `POST /validations` (D-04). `GET /validations/:id` no lo exige.
- Código ISO 3166-1 alfa-2; se normaliza a mayúsculas.
- Debe existir en el catálogo local y estar habilitado.

---

## Componentes

| Componente | Archivo |
| --- | --- |
| `CountriesModule` | `src/countries/countries.module.ts` (importa `MongoModule`, exporta `CountriesService`; no global) |
| `CountriesService` | `src/countries/services/countries.service.ts` |
| `CountryRepository` | `src/countries/repositories/country.repository.ts` |
| `countryCodeSchema` | `src/countries/schemas/country-code.schema.ts` |
| `COUNTRIES_SEED` | `src/countries/seeds/countries.seed.ts` |
| `ICountry`, `ICountrySeed` | `src/countries/interfaces/country.interface.ts` |

---

## Colección `countries`

```typescript
export interface ICountry {
  code: string;      // ISO 3166-1 alfa-2, mayúsculas
  name: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

Índice `code_unique`: `{ code: 1 }` único. No hay endpoints públicos para administrar países.

---

## Seed idempotente

```typescript
export const COUNTRIES_SEED: readonly ICountrySeed[] = [
  { code: 'CO', name: 'Colombia', enabled: true },
  { code: 'MX', name: 'Mexico', enabled: true },
];
```

`CountryRepository.seed()` ejecuta, por cada país:

```typescript
updateOne(
  { code },
  { $setOnInsert: { code, name, enabled, createdAt: now, updatedAt: now } },
  { upsert: true },
);
```

- Ejecutarlo varias veces no duplica registros (`upsert` + índice único).
- `$setOnInsert` **no sobrescribe** cambios hechos después (por ejemplo, un país deshabilitado a mano).
- Lo ejecuta `npm run infra:init` (ver [`configuracion-arranque.md`](./configuracion-arranque.md#inicialización-de-infraestructura-npm-run-infrainit)). Sin ese paso el catálogo está vacío y todo `POST` responde `400`.
- Solo `CO` y `MX`: no se agregan países sin una decisión explícita ni se afirma en qué países opera Auco.

---

## Validación del país en el POST

El país pasa por tres capas; solo la última es fuente de verdad:

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| 1. Contexto de la solicitud | `RequestContextMiddleware` | Guarda el header en mayúsculas si tiene formato de dos letras, **solo para correlación**. No se usa en lógica de negocio (D-14). |
| 2. Formato | `createValidationHeadersSchema` → `countryCodeSchema` | `trim`, mayúsculas y `^[A-Z]{2}$`. Si falla: `400 Validation failed`. |
| 3. Catálogo | `CountriesService.assertEnabled()` | El país debe existir y tener `enabled: true`. |

```typescript
async assertEnabled(code: string): Promise<ICountry> {
  const normalized = countryCodeSchema.parse(code);
  const country = await this.countries.findByCode(normalized);
  if (country === null) throw new UnsupportedCountryException('NOT_FOUND');
  if (!country.enabled) throw new UnsupportedCountryException('DISABLED');
  return country;
}
```

País desconocido y país deshabilitado responden **lo mismo**: `400 Unsupported country code`. El motivo (`reason`) queda interno para no revelar el contenido del catálogo.

El orden en el `POST` es: replay idempotente (si hay clave) → país → REST Countries → transacción. Un país inválido nunca llega al proveedor ni a la base de datos.

---

## Cómo habilitar, deshabilitar o agregar un país

**Deshabilitar o habilitar un país existente** (en `mongosh`, ver el [README](../../README.md#inspeccionar-los-datos-locales)):

```javascript
use external_validation
db.countries.updateOne({ code: 'MX' }, { $set: { enabled: false, updatedAt: new Date() } })
```

El cambio se aplica de inmediato: no hay caché en memoria del catálogo.

**Agregar un país de forma permanente:**

1. Añadirlo a `COUNTRIES_SEED` (requiere aprobación: no se agregan países sin decisión explícita).
2. Ejecutar `npm run infra:init`.
3. Actualizar las pruebas de `CountriesService` e `initializeInfrastructure`, que verifican el seed actual.
