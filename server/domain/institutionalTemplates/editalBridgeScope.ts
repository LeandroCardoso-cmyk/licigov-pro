/**
 * Institutional Templates — ADAPTER DE FRONTEIRA entre os parâmetros canônicos do Edital do processo (vocabulário legado do
 * domínio: `eletronico`, `compras_gov`, `portal_proprio`…) e o `BindingScope` institucional (slugs `[a-z0-9]+(-[a-z0-9]+)*`).
 *
 * Regras (função PURA, sem I/O):
 *  - mapeamento EXPLÍCITO e fechado: valor desconhecido NUNCA é aproximado, normalizado por heurística nem inventado;
 *  - SÓ modalidade, forma e plataforma entram no escopo de APLICABILIDADE. Critério de julgamento e regime de execução continuam
 *    sendo fatos/decisões de COMPOSIÇÃO do processo e NÃO são adicionados ao escopo do binding;
 *  - a normalização acontece AQUI, antes do resolvedor; o resolvedor (`resolveTemplateBinding`) segue com igualdade exata;
 *  - plataforma "outra" não possui slug institucional explícito ⇒ não resolve (nada é aproximado);
 *  - forma presencial não possui plataforma.
 * Não altera nenhum valor persistido do domínio legado.
 */
import type { BindingScope } from "./binding";

export const EDITAL_MODALITY_TO_SLUG = Object.freeze({
  pregao: "pregao", concorrencia: "concorrencia", leilao: "leilao", concurso: "concurso",
  chamada_publica: "chamada-publica", credenciamento: "credenciamento", registro_de_precos: "registro-de-precos",
} as const);
export const EDITAL_FORM_TO_SLUG = Object.freeze({ eletronico: "eletronica", presencial: "presencial" } as const);
export const EDITAL_PLATFORM_TO_SLUG = Object.freeze({
  bll: "bll", compras_gov: "compras-gov", licitanet: "licitanet", portal_proprio: "propria",
} as const);

export interface EditalBoundaryParams {
  readonly modality?: string | null;
  readonly form?: string | null;
  readonly platform?: string | null;
}

export type EditalScopeAdaptation =
  | { readonly ok: true; readonly scope: BindingScope }
  | { readonly ok: false; readonly reason: "PARAMETERS_INCOMPLETE" | "UNMAPPED_MODALITY" | "UNMAPPED_FORM" | "UNMAPPED_PLATFORM"; readonly detail: string };

const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key);

export function adaptEditalParamsToBindingScope(params: EditalBoundaryParams): EditalScopeAdaptation {
  const { modality, form, platform } = params;
  if (!modality || !form) return { ok: false, reason: "PARAMETERS_INCOMPLETE", detail: "modalidade e forma são necessárias para resolver o modelo institucional" };
  if (!has(EDITAL_MODALITY_TO_SLUG, modality)) return { ok: false, reason: "UNMAPPED_MODALITY", detail: `modalidade sem slug institucional: ${modality}` };
  if (!has(EDITAL_FORM_TO_SLUG, form)) return { ok: false, reason: "UNMAPPED_FORM", detail: `forma sem slug institucional: ${form}` };
  const base = {
    modality: EDITAL_MODALITY_TO_SLUG[modality as keyof typeof EDITAL_MODALITY_TO_SLUG],
    form: EDITAL_FORM_TO_SLUG[form as keyof typeof EDITAL_FORM_TO_SLUG],
  };
  if (form === "presencial") return { ok: true, scope: base };   // presencial não tem plataforma
  if (!platform) return { ok: false, reason: "PARAMETERS_INCOMPLETE", detail: "a forma eletrônica exige a plataforma para resolver o modelo institucional" };
  if (!has(EDITAL_PLATFORM_TO_SLUG, platform)) return { ok: false, reason: "UNMAPPED_PLATFORM", detail: `plataforma sem slug institucional: ${platform}` };
  return { ok: true, scope: { ...base, platform: EDITAL_PLATFORM_TO_SLUG[platform as keyof typeof EDITAL_PLATFORM_TO_SLUG] } };
}
