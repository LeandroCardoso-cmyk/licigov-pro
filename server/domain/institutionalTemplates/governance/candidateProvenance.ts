/**
 * VALIDAÇÃO INTEGRAL da procedência de uma revisão CANDIDATA — domínio puro e determinístico.
 *
 * Existir uma decisão de procedência não prova que ela descreve ESTA candidata: uma procedência de outro conteúdo (p.ex. da Revisão 1), de outra
 * fonte, escopo ou inventário seria aceita por um teste de presença. Aqui a procedência persistida (decodificada pelo mesmo contrato de
 * `importProvenance.ts`) é comparada, campo a campo, com a PROJEÇÃO ESPERADA derivada do pacote versionado e da revisão exata.
 *
 * Estados (mutuamente exclusivos):
 *  - ABSENT     nenhuma decisão de procedência para a revisão ⇒ recuperação idempotente governada (só em DRAFT);
 *  - CORRECT    a procedência CORRENTE (maior versão do ledger append-only) bate com a projeção esperada ⇒ convergir SEM escrever;
 *  - DIVERGENT  decodifica, mas difere em ≥ 1 campo ⇒ recusa explícita (nunca sobrescreve nem "conserta" em silêncio);
 *  - MALFORMED  a decisão corrente não decodifica, é de outro tenant/assunto ⇒ falha governada e observável (não é "ausente").
 * O ledger é append-only: a regularização é uma NOVA versão humana (que passa a ser a corrente), nunca apagar/alterar o histórico.
 */
import type { InstitutionalDecision } from "../../institutionalDecision";
import { decodeImportProvenance, type ImportProvenance, type ImportProvenanceInput } from "./importProvenance";
import { readScope, SCOPE_DIMENSIONS } from "./scopeDimensions";

export type CandidateProvenanceState = "ABSENT" | "CORRECT" | "DIVERGENT" | "MALFORMED";

export interface ProvenanceDiff { readonly field: string; readonly expected: string; readonly actual: string }

export interface ExpectedCandidateProvenance {
  /** Id EXATO da revisão candidata (o assunto das decisões de procedência). */
  readonly revisionId: string;
  /** Hash semântico EXATO da revisão (a procedência registra o hash da revisão a que se refere). */
  readonly revisionSemanticHash: string;
  readonly input: ImportProvenanceInput;
}

export interface CandidateProvenanceReport {
  readonly state: CandidateProvenanceState;
  /** Quantidade de versões da procedência no ledger (append-only). */
  readonly versions: number;
  readonly diffs: readonly ProvenanceDiff[];
  readonly detail: string;
}

const ABSENT_TEXT = "(ausente)";
const text = (v: string | number | null | undefined): string => (v === undefined || v === null || v === "" ? ABSENT_TEXT : String(v));

/** Diferenças entre a procedência decodificada e a esperada. Vazio ⇒ equivalentes em TODOS os campos de integridade. */
export function diffImportProvenance(expected: ExpectedCandidateProvenance, actual: ImportProvenance): ProvenanceDiff[] {
  const out: ProvenanceDiff[] = [];
  const cmp = (field: string, e: string | number | null | undefined, a: string | number | null | undefined): void => {
    if (text(e) !== text(a)) out.push({ field, expected: text(e), actual: text(a) });
  };
  const i = expected.input;
  cmp("revisionId", expected.revisionId, actual.revisionId);
  cmp("revisionSemanticHash", expected.revisionSemanticHash, actual.revisionSemanticHash);
  cmp("templateKey", i.templateKey, actual.templateKey);
  cmp("displayName", i.displayName, actual.displayName);
  cmp("sourceLogicalVersion", i.sourceLogicalVersion, actual.sourceLogicalVersion);
  cmp("sourceSha256", i.sourceSha256, actual.sourceSha256);
  cmp("sourceFormat", i.sourceFormat, actual.sourceFormat);
  if (i.inventory && !actual.inventory) out.push({ field: "inventory", expected: "presente", actual: ABSENT_TEXT });
  else if (!i.inventory && actual.inventory) out.push({ field: "inventory", expected: ABSENT_TEXT, actual: "presente" });
  else if (i.inventory && actual.inventory) {
    cmp("inventory.sha256", i.inventory.sha256, actual.inventory.sha256);
    cmp("inventory.inputsTotal", i.inventory.inputsTotal, actual.inventory.inputsTotal);
    cmp("inventory.controlOnlyInputs", i.inventory.controlOnlyInputs, actual.inventory.controlOnlyInputs);
    cmp("inventory.conditionTypes", i.inventory.conditionTypes, actual.inventory.conditionTypes);
  }
  const eScope = readScope(i.scope); const aScope = readScope(actual.scope);
  for (const d of SCOPE_DIMENSIONS) cmp(`scope.${d}`, eScope[d], aScope[d]);
  return out;
}

/**
 * Avalia o ledger de procedência de UMA revisão. `decisions` é o histórico completo (v1…corrente) do assunto, na ordem de versão; só a CORRENTE
 * decide o estado (regularização humana = nova versão). Decisão de outro tenant/assunto ⇒ MALFORMED (defesa em profundidade; o repositório já filtra por tenant).
 */
export function evaluateCandidateProvenance(expected: ExpectedCandidateProvenance, decisions: readonly InstitutionalDecision[], organizationId: number): CandidateProvenanceReport {
  const versions = decisions.length;
  if (versions === 0) return { state: "ABSENT", versions, diffs: [], detail: "nenhuma decisão de procedência registrada para esta revisão" };
  const foreign = decisions.filter((d) => d.organizationId !== organizationId || d.subjectId !== expected.revisionId);
  if (foreign.length) return { state: "MALFORMED", versions, diffs: [], detail: `${foreign.length} decisão(ões) de procedência de outro tenant/assunto no histórico da revisão (inconsistência do ledger)` };
  const current = decisions[decisions.length - 1];
  const decoded = decodeImportProvenance(current);
  if (!decoded) return { state: "MALFORMED", versions, diffs: [], detail: `a procedência corrente (v${current.revision}) não pôde ser decodificada (campos ausentes/ilegíveis)` };
  const diffs = diffImportProvenance(expected, decoded);
  if (diffs.length) {
    return { state: "DIVERGENT", versions, diffs, detail: `a procedência corrente (v${current.revision}) diverge do esperado em: ${diffs.map((d) => `${d.field} (esperado ${d.expected}; encontrado ${d.actual})`).join("; ")}` };
  }
  return { state: "CORRECT", versions, diffs: [], detail: `procedência corrente (v${current.revision}) confere com o pacote e com a revisão exata` };
}
