/**
 * A3 — Normalização de JSON Schema para o subset aceito pelo Gemini (boundary do PROVIDER).
 *
 * O domínio declara `responseSchema` provider-agnostic (JSON Schema padrão, incluindo
 * `additionalProperties: false` para strictness). O Gemini, porém, rejeita esse campo em
 * `generation_config.response_schema` (400 Bad Request: `Unknown name "additionalProperties"`),
 * inclusive em objetos aninhados e em objetos dentro de arrays.
 *
 * Esta é uma adaptação de FRONTEIRA: converte o schema para o subset do Gemini SEM alterar o
 * contrato canônico do domínio. A validação estrita final continua sendo do Zod na aplicação
 * (o schema do provider apenas orienta a geração — não substitui a autoridade de validação).
 *
 * Regra: remover recursivamente a chave `additionalProperties` em qualquer profundidade (raiz,
 * objetos, `items`, objetos dentro de arrays), preservando todos os demais campos suportados
 * (`type`, `properties`, `required`, `items`, `enum`, `description`, `nullable`, ...). Puro e
 * NÃO-MUTATIVO: retorna uma nova estrutura; o schema original permanece intacto.
 */

/** Chave não suportada pelo response_schema do Gemini — removida em qualquer profundidade. */
const UNSUPPORTED_KEYS: ReadonlySet<string> = new Set(["additionalProperties"]);

export function normalizeGeminiResponseSchema<T>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeGeminiResponseSchema(item)) as unknown as T;
  }
  if (schema !== null && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYS.has(key)) continue; // remove (qualquer profundidade); não copia
      out[key] = normalizeGeminiResponseSchema(value);
    }
    return out as unknown as T;
  }
  // Primitivos (string/number/boolean/null): inalterados.
  return schema;
}
