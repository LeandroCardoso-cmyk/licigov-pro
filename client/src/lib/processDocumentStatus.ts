/**
 * M8 (homologação visual) — situação documental do Processo Licitatório, regra pura (sem React/rede).
 *
 * Três informações distintas que a UI não pode misturar:
 *  - ETAPA REGISTRADA (`procurement_processes.current_stage`): marco administrativo gravado; só muda por transição
 *    canônica (ex.: emissão do processo). Não acompanha a elaboração dos documentos.
 *  - SITUAÇÃO DO RASCUNHO (`generated_documents.status`): estado do texto em elaboração.
 *  - VERSÕES OFICIAIS (ledger `official_document_promotions`): última versão EMITIDA por tipo — imutável.
 */

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  NEW_PROCESS: "Novo Processo",
  DFD: "DFD",
  ETP: "ETP",
  PRICE_RESEARCH: "Pesquisa de Preços",
  ITEM_WORKSPACE: "Itens",
  TR: "Termo de Referência",
  NOTICE: "Edital",
  REVIEW: "Revisão",
  ISSUED: "Emitido",
  ARCHIVED: "Arquivado",
};

export const MODALITY_LABELS: Readonly<Record<string, string>> = {
  pregao: "Pregão",
  concorrencia: "Concorrência",
  leilao: "Leilão",
  concurso: "Concurso",
  chamada_publica: "Chamada Pública",
  credenciamento: "Credenciamento",
  registro_de_precos: "Registro de Preços",
};

export const DOCUMENT_KIND_LABELS: Readonly<Record<string, string>> = {
  dfd: "DFD", etp: "ETP", tr: "TR", edital: "Edital",
};

const DRAFT_STATUS_LABELS: Readonly<Record<string, string>> = {
  rascunho: "Rascunho", em_revisao: "Em revisão", aprovado: "Aprovado", emitido: "Emitido", arquivado: "Arquivado",
};

/** Ordem do fluxo documental (do mais avançado para o menos). */
const FLOW_DESC = ["edital", "tr", "etp"] as const;

export type OfficialVersions = Readonly<Partial<Record<string, number>>>;

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  return STAGE_LABELS[stage] ?? stage;
}

export function modalityLabel(modality: string | null | undefined): string {
  if (!modality) return "—";
  return MODALITY_LABELS[modality] ?? modality;
}

export function draftStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return DRAFT_STATUS_LABELS[status] ?? status;
}

/** "Emitido v2" quando há versão oficial do tipo; null quando nunca foi emitido. */
export function officialVersionLabel(versions: OfficialVersions | null | undefined, kind: string): string | null {
  const v = versions?.[kind];
  return typeof v === "number" && v > 0 ? `Emitido v${v}` : null;
}

/**
 * Documento oficial mais avançado do fluxo (Edital > TR > ETP), ex.: "TR emitido (v2)". null = nenhum emitido.
 * Derivado só do ledger de emissões — nunca da etapa registrada.
 */
export function latestOfficialSummary(versions: OfficialVersions | null | undefined): string | null {
  for (const kind of FLOW_DESC) {
    const v = versions?.[kind];
    if (typeof v === "number" && v > 0) return `${DOCUMENT_KIND_LABELS[kind]} emitido (v${v})`;
  }
  return null;
}

/** Data/hora legível em pt-BR (nunca o ISO cru); entrada inválida volta como veio. */
export function formatDateTimeBR(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Autoria registrada: nome do membro quando disponível; senão o id, sem inventar identidade. */
export function actorLabel(actorName: string | null | undefined, actorId: string | number | null | undefined): string {
  if (actorName && actorName.trim()) return actorName.trim();
  if (actorId === null || actorId === undefined || actorId === "") return "Sistema";
  const m = /^(?:user:)?(\d+)$/.exec(String(actorId));
  if (m) return `Usuário nº ${m[1]}`;
  return String(actorId) === "sistema" ? "Sistema" : String(actorId);
}
