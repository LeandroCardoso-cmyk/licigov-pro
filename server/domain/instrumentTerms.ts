/**
 * R7 / PR-17 (SEM-024) — Termo Aditivo / Apostilamento a partir do INSTRUMENTO REGISTRADO (regra pura).
 *
 * Antes: o termo era "CLÁUSULA n. ${sugestão do copiloto}" + cabeçalho; não lia justificativa/novo valor/novo prazo do
 * aditivo nem novo valor/gestor/fiscal do apostilamento; autor `multi_copilot`.
 * Agora: as cláusulas vêm dos dados persistidos do instrumento; a IA aparece só numa seção ROTULADA de sugestões não
 * incorporadas; nada é inventado (campo ausente ⇒ "sem alteração" / [REVISAR]).
 */
import { formatCentsBRL } from "@shared/money";
import { legalPolicyReviewLine } from "./legalReviewPolicy";

export const INSTRUMENT_REFERENCE_REQUIRED = "INSTRUMENT_REFERENCE_REQUIRED";
export const INSTRUMENT_NOT_FOUND = "INSTRUMENT_NOT_FOUND";

export interface ContractHeader {
  readonly contractNumber: string;
  readonly contractor: string;
  readonly object: string;
  readonly term: string;
}

export interface AddendumData {
  readonly id: string; readonly sequence: number; readonly addendumType: string; readonly justification: string;
  /** Reais (DECIMAL(15,2) persistido). 0 = sem alteração de valor. */
  readonly newValue: number; readonly newTerm: string; readonly status: string;
}

export interface ApostilleData {
  readonly id: string; readonly sequence: number; readonly kind: string; readonly description: string;
  readonly newValue: number; readonly newManager: string; readonly newInspector: string;
}

const ADDENDUM_TYPE_LABEL: Record<string, string> = {
  prazo: "prorrogação/alteração de prazo", valor: "alteração de valor", quantitativo: "alteração quantitativa", qualitativo: "alteração qualitativa",
};
const APOSTILLE_KIND_LABEL: Record<string, string> = {
  reajuste: "reajuste", gestor: "substituição do gestor do contrato", fiscal: "substituição do fiscal do contrato", legal: "registro de alteração legal",
};

const reais = (v: number): string => formatCentsBRL(Math.round(v * 100));
const or = (v: string, fallback: string): string => (v.trim() ? v.trim() : fallback);

function header(title: string, c: ContractHeader): string[] {
  return [
    `# ${title} — ${c.contractNumber}`,
    `Contratado: ${or(c.contractor, "—")} · Objeto: ${or(c.object, "—")} · Vigência atual: ${or(c.term, "—")}`,
    "",
  ];
}

function suggestionsSection(suggestions: readonly string[]): string[] {
  if (suggestions.length === 0) return [];
  return [
    "## Sugestões dos copilotos (NÃO incorporadas ao termo — revisar)",
    ...suggestions.map((s) => `- ${s}`),
    "",
  ];
}

export function buildAddendumTermContent(c: ContractHeader, a: AddendumData, suggestions: readonly string[] = [], legalBasis: readonly string[] = []): string {
  return [
    ...header(`Termo Aditivo nº ${a.sequence}`, c),
    "## Cláusula primeira — Do objeto do aditivo",
    `${ADDENDUM_TYPE_LABEL[a.addendumType] ?? a.addendumType} ao contrato ${c.contractNumber}.`,
    "",
    "## Cláusula segunda — Da justificativa",
    or(a.justification, "[REVISAR: justificativa não registrada no aditivo]"),
    "",
    "## Cláusula terceira — Das alterações",
    `- Valor: ${a.newValue > 0 ? reais(a.newValue) : "sem alteração de valor"}`,
    `- Prazo/vigência: ${or(a.newTerm, "sem alteração de prazo")}`,
    "",
    "## Cláusula quarta — Da ratificação",
    "Permanecem inalteradas as demais cláusulas do contrato original.",
    "",
    ...(a.status === "aguardando_parecer" ? ["> [REVISAR: aditivo aguardando parecer jurídico — não assinar antes do parecer.]", ""] : []),
    // R8 / PR-20 scaffolding (SEM-084): limites do art. 125 não são afirmados pelo sistema sem parecer.
    ...(a.addendumType === "valor" || a.addendumType === "quantitativo" || a.addendumType === "prazo"
      ? [legalPolicyReviewLine("SEM-084_CANONICAL_ADDENDUM_LIMITS"), ""].filter((x): x is string => x !== null)
      : []),
    ...(legalBasis.length ? ["## Fundamentação (referências sugeridas — revisar)", ...legalBasis.map((l) => `- ${l}`), ""] : []),
    ...suggestionsSection(suggestions),
    `> Termo gerado a partir do aditivo registrado (${a.id}). Revisão obrigatória — nunca automática.`,
  ].join("\n");
}

export function buildApostilleTermContent(c: ContractHeader, a: ApostilleData, suggestions: readonly string[] = []): string {
  return [
    ...header(`Apostilamento nº ${a.sequence}`, c),
    "## Do registro",
    `${APOSTILLE_KIND_LABEL[a.kind] ?? a.kind} no contrato ${c.contractNumber}.`,
    "",
    "## Descrição",
    or(a.description, "[REVISAR: descrição não registrada no apostilamento]"),
    "",
    "## Alterações registradas",
    `- Valor: ${a.newValue > 0 ? reais(a.newValue) : "sem alteração de valor"}`,
    `- Gestor do contrato: ${or(a.newManager, "sem alteração")}`,
    `- Fiscal do contrato: ${or(a.newInspector, "sem alteração")}`,
    "",
    ...suggestionsSection(suggestions),
    `> Apostilamento gerado a partir do registro (${a.id}). Revisão obrigatória — nunca automática.`,
  ].join("\n");
}
