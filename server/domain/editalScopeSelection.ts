/**
 * ESCOPO DO EDITAL ANTES DA GERAÇÃO — modalidade/forma/plataforma escolhidas pela pessoa ficam registradas como fato do
 * Contexto Canônico (`edital.scope`, fonte `user`, ator humano, append-only), para não se perderem ao recarregar a página
 * antes da primeira geração. Puro (sem I/O).
 *
 * Precedência (servidor e tela): parâmetros PERSISTIDOS do Edital gerado > escopo registrado aqui. O registro é só a
 * escolha da pessoa: não gera, não aprova e não publica nada; não altera documento existente.
 */
import { resolveField, type FactAssertion } from "./canonicalProcurementContext";
import type { EditalForm, EditalModality, EditalPlatform } from "./generatedDocument";

export const EDITAL_SCOPE_PATH = "edital.scope" as const;

export const EDITAL_SCOPE_MODALITIES: readonly EditalModality[] = ["pregao", "concorrencia", "leilao", "concurso", "chamada_publica", "credenciamento", "registro_de_precos"];
export const EDITAL_SCOPE_FORMS: readonly EditalForm[] = ["eletronico", "presencial"];
export const EDITAL_SCOPE_PLATFORMS: readonly EditalPlatform[] = ["compras_gov", "bll", "licitanet", "portal_proprio", "outra"];

export interface EditalScope {
  readonly modality: EditalModality;
  readonly form: EditalForm;
  /** Só na forma eletrônica; presencial ⇒ null. */
  readonly platform: EditalPlatform | null;
}

export type EditalScopeRefusal = "SCOPE_INCOMPLETE" | "SCOPE_INVALID";

/** Normaliza e valida a escolha: completa (plataforma exigida só na forma eletrônica) e dentro das listas conhecidas. */
export function normalizeEditalScope(input: { readonly modality?: string | null; readonly form?: string | null; readonly platform?: string | null }):
  { readonly ok: true; readonly scope: EditalScope } | { readonly ok: false; readonly reason: EditalScopeRefusal } {
  const { modality, form } = input;
  const platform = form === "eletronico" ? input.platform ?? null : null;
  if (!modality || !form || (form === "eletronico" && !platform)) return { ok: false, reason: "SCOPE_INCOMPLETE" };
  if (!EDITAL_SCOPE_MODALITIES.includes(modality as EditalModality) || !EDITAL_SCOPE_FORMS.includes(form as EditalForm)
    || (platform !== null && !EDITAL_SCOPE_PLATFORMS.includes(platform as EditalPlatform))) return { ok: false, reason: "SCOPE_INVALID" };
  return { ok: true, scope: { modality: modality as EditalModality, form: form as EditalForm, platform: platform as EditalPlatform | null } };
}

const MODALITY_LABEL: Record<EditalModality, string> = {
  pregao: "Pregão", concorrencia: "Concorrência", leilao: "Leilão", concurso: "Concurso", chamada_publica: "Chamada pública",
  credenciamento: "Credenciamento", registro_de_precos: "Registro de preços",
};
const FORM_LABEL: Record<EditalForm, string> = { eletronico: "eletrônica", presencial: "presencial" };
const PLATFORM_LABEL: Record<EditalPlatform, string> = { compras_gov: "Compras.gov.br", bll: "BLL", licitanet: "Licitanet", portal_proprio: "portal próprio", outra: "outra plataforma" };

/** Texto humano do escopo (linha do tempo). */
export function describeEditalScope(s: EditalScope): string {
  return `${MODALITY_LABEL[s.modality]}, forma ${FORM_LABEL[s.form]}${s.platform ? `, plataforma ${PLATFORM_LABEL[s.platform]}` : ""}`;
}

/** Valor canônico do fato (JSON com chaves em ordem fixa ⇒ mesmo escopo, mesmo hash). */
export function encodeEditalScope(scope: EditalScope): string {
  return JSON.stringify({ modality: scope.modality, form: scope.form, platform: scope.form === "eletronico" ? scope.platform : null });
}

/** Lê o valor do fato; qualquer coisa fora do contrato ⇒ null (nunca um escopo presumido). */
export function decodeEditalScope(value: unknown): EditalScope | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const r = normalizeEditalScope(parsed as Record<string, string | null>);
  return r.ok ? r.scope : null;
}

export interface EditalScopeSelection {
  readonly scope: EditalScope | null;
  /** Hash do valor vigente (base da superação consciente / CAS); null quando nada foi registrado. */
  readonly valueHash: string | null;
  readonly actorUserId: number | null;
  readonly updatedAt: string | null;
  /** Afirmações divergentes de mesma autoridade (não esperado: só há uma fonte). Nada é escolhido. */
  readonly conflict: boolean;
}

export function editalScopeSelection(facts: readonly FactAssertion[]): EditalScopeSelection {
  const f = resolveField(EDITAL_SCOPE_PATH, facts);
  if (f.status === "conflict") return { scope: null, valueHash: null, actorUserId: null, updatedAt: null, conflict: true };
  return { scope: decodeEditalScope(f.value), valueHash: f.valueHash, actorUserId: f.actorUserId, updatedAt: f.updatedAt, conflict: false };
}
