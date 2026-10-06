/**
 * R10 / SEM-087 (parte B) — pré-condições de EMISSÃO do processo (`issueProcess`).
 *
 * "Emitido" tem UM significado: emissão OFICIAL governada (ledger `official_document_promotions`). O processo só é
 * marcado como emitido quando os TRÊS documentos da cadeia (ETP → TR → Edital) têm versão OFICIAL emitida; antes
 * bastava o Edital, deixando ETP/TR apenas em rascunho/aprovado. A recusa lista, com precisão, o que falta.
 * (A parte A do SEM-087 — escopo da SoD: autor/último editor × todos os editores substantivos — é DECISÃO HUMANA e não
 * é tratada aqui.)
 */
export const PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS = "PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS";

export type IssuableKind = "etp" | "tr" | "edital";
export const ISSUE_REQUIRED_KINDS: readonly IssuableKind[] = ["etp", "tr", "edital"];
const LABEL: Record<IssuableKind, string> = { etp: "ETP", tr: "TR", edital: "Edital" };

/** Documentos exigidos que ainda NÃO têm versão oficial emitida (ordem da cadeia). */
export function missingOfficialKinds(official: Readonly<Record<IssuableKind, unknown | null | undefined>>): IssuableKind[] {
  return ISSUE_REQUIRED_KINDS.filter((k) => !official[k]);
}

/** Mensagem de recusa (null = pode projetar a etapa ISSUED). */
export function processIssueRefusalMessage(missing: readonly IssuableKind[]): string | null {
  if (missing.length === 0) return null;
  const reasons = missing.map((k) => `${LABEL[k]} sem versão OFICIAL emitida`).join("; ");
  return `${PROCESS_ISSUE_REQUIRES_EMITTED_DOCUMENTS}: o processo só é marcado como emitido depois da emissão OFICIAL do ETP, do TR e do Edital (revisão de terceiro/SoD) — pendente: ${reasons}.`;
}
