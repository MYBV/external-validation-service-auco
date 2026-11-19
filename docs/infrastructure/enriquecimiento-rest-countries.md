# Enriquecimiento Geográfico: REST Countries v5

**Índice de Documentación**: Ver [`../documentation-index.md`](../documentation-index.md)
**Proyecto**: `external-validation-service-auco` · **Última actualización**: Noviembre 2026

---

## Tabla de Contenidos

1. [Introducción y alcance](#introducción-y-alcance)
2. [Componentes](#componentes)
3. [Contrato del proveedor](#contrato-del-proveedor)
4. [Configuración](#configuración)
5. [Flujo de una consulta](#flujo-de-una-consulta)
6. [Validación de la respuesta (Zod)](#validación-de-la-respuesta-zod)
7. [Datos guardados: ICountryEnrichment](#datos-guardados-icountryenrichment)
8. [Manejo de errores](#manejo-de-errores)
9. [Privacidad y logs](#privacidad-y-logs)
10. [Smoke test con clave real](#smoke-test-con-clave-real)
11. [Pruebas](#pruebas)

---

## Introducción y alcance

El enunciado pide consultar una API pública gratuita para enriquecer cada validación. Se eligió **REST Countries** (en lugar de una API de tipo de cambio) porque aporta contexto geográfico del país indicado por el cliente.

> **El enriquecimiento no verifica identidad.** No confirma titularidad documental, residencia ni nacionalidad. Solo describe el país elegido explícitamente en el header `x-country-code`. Nunca se deduce el país a partir del número de documento.

---

## Componentes

| Componente | Archivo | Responsabilidad |
| --- | --- | --- |
| `EnrichmentModule` | `src/enrichment/enrichment.module.ts` | Importa `HttpModule` (timeout `HTTP_TIMEOUT_MS`, `maxRedirects: 0`); provee y exporta `RestCountriesService`. No es global. |
| `RestCountriesService` | `src/enrichment/services/rest-countries.service.ts` | Llamada HTTP, validación, mapeo y traducción de errores. |
| `restCountriesResponseSchema` | `src/enrichment/schemas/rest-countries.schema.ts` | Esquema Zod de la parte de la respuesta que se usa. |
| `ICountryEnrichment` | `src/enrichment/interfaces/country-enrichment.interface.ts` | Fotografía geográfica guardada en la validación. |
| `requireRestCountriesConfig()` | `src/enrichment/enrichment-config.ts` | Exige `REST_COUNTRIES_API_KEY`. |

No existe un cliente HTTP genérico transversal: el `HttpService` de NestJS se usa directamente desde este servicio.

---

## Contrato del proveedor

Verificado en la documentación oficial (<https://restcountries.com/docs>):

| Concepto | Valor |
| --- | --- |
| Endpoint | `GET https://api.restcountries.com/countries/v5/codes.alpha_2/{CODE}` |
| Autenticación | `Authorization: Bearer <REST_COUNTRIES_API_KEY>` (nunca por query string) |
| Proyección | `response_fields=names.common,names.official,codes.alpha_2,region,subregion,capitals,languages,currencies` |
| Forma de la respuesta | `{ "data": { "objects": [ ... ] } }` |
| Código sin coincidencia | `200` con `objects` vacío (no `404`) |
| Plan gratuito | 1 000 solicitudes/mes y 20 cada 10 s; la cuenta puede deshabilitarse si los `4xx` superan el 15 % del límite |
| Clave demo `rc_live_demo` | Devuelve siempre un ejemplo fijo (Canadá): **no** sirve para validar el mapeo |

Las versiones anteriores (v3.1, sin clave, con `fields=` y `capital`) ya no aplican.

---

## Configuración

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `REST_COUNTRIES_BASE_URL` | `https://api.restcountries.com/countries/v5` | Se eliminan las barras finales. |
| `REST_COUNTRIES_API_KEY` | — | Exigida al construir el servicio. Distinta de `API_KEY`, que protege nuestra API. |
| `HTTP_TIMEOUT_MS` | `5000` | Timeout de axios para la llamada. |

Si la variable **falta**, la aplicación no arranca (`REST Countries enrichment requires REST_COUNTRIES_API_KEY to be set`). Con el marcador de `.env.example` arranca, pero el proveedor rechaza la clave y el `POST` responde `502`.

---

## Flujo de una consulta

```
ValidationsService.create()
   → CountriesService.assertEnabled(país)      ← el país existe y está habilitado
   → RestCountriesService.enrich(code)
        1. countryCodeSchema.parse(code)        ← solo el código ISO sale del servicio
        2. GET {base}/codes.alpha_2/{CODE}?response_fields=...
           Authorization: Bearer <clave>
        3. restCountriesResponseSchema.safeParse(body)
        4. objects vacío                → 502
        5. buscar objects[i].codes.alpha_2 == CODE
           (sin coincidencia            → 502)
        6. mapear a ICountryEnrichment
   → transacción MongoDB (fuera de la llamada HTTP)
```

- Se llama **una sola vez** por creación, antes de la transacción y nunca dentro de ella.
- En un replay idempotente **no** se llama al proveedor.
- No hay reintentos automáticos.

---

## Validación de la respuesta (Zod)

```typescript
const restCountrySchema = z.object({
  codes: z.object({ alpha_2: z.string().min(1) }),
  names: z.object({ common: z.string().min(1), official: z.string().nullish() }),
  region: z.string().nullish(),
  subregion: z.string().nullish(),
  capitals: z.array(z.object({ name: z.string().min(1) })).nullish(),
  languages: z.array(z.object({ name: z.string().min(1) })).nullish(),
  currencies: z.array(z.object({
    code: z.string().min(1), name: z.string().min(1), symbol: z.string().nullish(),
  })).nullish(),
});

export const restCountriesResponseSchema = z.object({
  data: z.object({ objects: z.array(restCountrySchema) }),
});
```

- `codes.alpha_2` y `names.common` son obligatorios; el resto tolera ausencia o `null`.
- Los campos desconocidos se descartan: nunca se guarda el payload completo.
- `data.meta` y el aviso de la clave demo no forman parte del esquema.

---

## Datos guardados: ICountryEnrichment

```typescript
export interface ICountryEnrichment {
  source: 'rest-countries';
  code: string;
  commonName: string;
  officialName?: string;
  region?: string;
  subregion?: string;
  capitals: string[];
  languages: string[];
  currencies: { code: string; name: string; symbol?: string }[];
  enrichedAt: Date;
}
```

Ejemplo ilustrativo para `CO`:

```json
{
  "source": "rest-countries",
  "code": "CO",
  "commonName": "Colombia",
  "officialName": "Republic of Colombia",
  "region": "Americas",
  "subregion": "South America",
  "capitals": ["Bogotá"],
  "languages": ["Spanish"],
  "currencies": [{ "code": "COP", "name": "Colombian peso", "symbol": "$" }],
  "enrichedAt": "2026-11-19T15:30:00.000Z"
}
```

Se guarda dentro de la validación (`validations.enrichment`) y se devuelve en `GET /validations/:id`.

---

## Manejo de errores

Los errores del proveedor se traducen a excepciones HTTP fijas, sin reflejar su código ni su mensaje (mensaje público: `Geographic enrichment unavailable`):

| Situación | Respuesta del servicio |
| --- | --- |
| Timeout (`ECONNABORTED`, `ETIMEDOUT`) | `504 Gateway Timeout` |
| `429` (límite de tasa) | `503 Service Unavailable` |
| `401`, `403`, `404`, `5xx` | `502 Bad Gateway` |
| Error de red (sin respuesta) | `502 Bad Gateway` |
| Respuesta que no cumple el esquema Zod | `502 Bad Gateway` |
| `objects` vacío | `502 Bad Gateway` |
| Ningún objeto con el `alpha_2` pedido | `502 Bad Gateway` |
| Error inesperado no HTTP | `502 Bad Gateway` |

Un fallo del proveedor **nunca** se convierte en un enriquecimiento ficticio: si falla, no se crea la validación ni el evento (la transacción no llega a iniciarse).

---

## Privacidad y logs

- Al proveedor solo se envía el **código ISO del país**. Nunca `name`, `documentNumber`, la `x-api-key` ni otros datos personales. Una prueba e2e lo comprueba (`never sends personal data to the enrichment provider`, en `test/validations.e2e-spec.ts`).
- La clave del proveedor viaja solo en el header `Authorization`, nunca en la URL.
- Los logs de fallo solo incluyen `requestId`, el motivo resumido y la duración:

```
[<requestId>] REST Countries lookup failed (status 429) after 312ms
```

Nunca se registran la URL, los headers, el body ni los mensajes del proveedor.

---

## Smoke test con clave real

Las pruebas automatizadas no consumen la API real. La integración con el proveedor real se verificó manualmente el 19/11/2026 con una clave propia: las solicitudes del servicio aparecen en el panel de REST Countries. Para repetir la comprobación del contrato:

```bash
npm run smoke:rest-countries   # nest build && node scripts/smoke-rest-countries.mjs
```

| Salida | Código | Significado |
| --- | --- | --- |
| `OK: HTTP 200, CO = "..."` | 0 | El contrato real coincide con el esquema Zod. |
| `FAILED: ...` | 1 | Fallo del proveedor, de red o del esquema. |
| `NOT EXECUTED: ...` | 2 | No hay una clave legítima (vacía, marcador o `rc_live_demo`). |

Hace **una** solicitud (`CO`) y no imprime la clave.

---

## Pruebas

| Archivo | Cubre |
| --- | --- |
| `src/enrichment/services/rest-countries.service.spec.ts` | Bearer enviado, `response_fields`, mapeo, timeout, `401`, `429`, `5xx`, red, esquema inválido, `objects` vacío, país distinto, logs sin datos sensibles |
| `src/enrichment/schemas/rest-countries.schema.spec.ts` | Campos obligatorios, opcionales y descarte de campos desconocidos |
| `test/validations.e2e-spec.ts` | Traducción a `502`, `503` y `504` en el endpoint |
