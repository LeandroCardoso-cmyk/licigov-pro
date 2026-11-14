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

/**
 * M8 — modalidade exibida na Visão Geral: a do processo; se o processo não a tem mas o escopo do Edital foi escolhido (fato
 * `edital.scope`), mostra-a indicando a origem. Só leitura: nada é gravado no processo.
 */
export function overviewModalityText(processModality: string | null | undefined, scopeModality: string | null | undefined): string {
  if (processModality) return modalityLabel(processModality);
  return scopeModality ? `${modalityLabel(scopeModality)} (escopo do Edital)` : "—";
}

export function draftStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return DRAFT_STATUS_LABELS[status] ?? status;
}

/** Situação do processo (`procurement_processes.status`) — a MESMA tabela da lista de processos e da Visão Geral. */
export const PROCESS_STATUS_LABELS: Readonly<Record<string, string>> = {
  rascunho: "Rascunho", em_andamento: "Em andamento", em_revisao: "Em revisão", emitido: "Emitido", arquivado: "Arquivado",
};

export function processStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PROCESS_STATUS_LABELS[status] ?? status;
}

const DRAFT_SITUATION_LABELS: Readonly<Record<string, string>> = {
  rascunho: "Rascunho em elaboração", em_revisao: "Rascunho em revisão", aprovado: "Rascunho aprovado",
  emitido: "Rascunho emitido", arquivado: "Rascunho arquivado",
};

/**
 * M8 — linha do rascunho na lista de documentos, em linguagem natural e sem repetir a palavra ("Rascunho: rascunho").
 * Valor desconhecido nunca é inventado: aparece como está, rotulado.
 */
export function draftSituationLabel(status: string | null | undefined): string {
  if (!status) return "Rascunho: —";
  return DRAFT_SITUATION_LABELS[status] ?? `Rascunho: ${status}`;
}

/** Número de emissões oficiais por tipo (ledger de emissões; append-only). */
export type OfficialEmissions = Readonly<Partial<Record<string, number>>>;

/**
 * M8 P3.3 — "1ª emissão" a partir do ordinal da emissão. A linhagem numera snapshots técnicos e emissões na mesma sequência, então a
 * revisão técnica da 1ª emissão costuma ser "v2" — mostrada só como detalhe. Sem ordinal conhecido ⇒ null (quem chama mostra "vN").
 */
export function emissionOrdinalLabel(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? `${n}ª emissão` : null;
}

/** "Emitido · 1ª emissão" quando há versão oficial do tipo ("Emitido v2" se o ordinal não vier); null quando nunca foi emitido. */
export function officialVersionLabel(versions: OfficialVersions | null | undefined, kind: string, emissions?: OfficialEmissions | null): string | null {
  const v = versions?.[kind];
  if (!(typeof v === "number" && v > 0)) return null;
  const ordinal = emissionOrdinalLabel(emissions?.[kind]);
  return ordinal ? `Emitido · ${ordinal}` : `Emitido v${v}`;
}

/**
 * Documento oficial mais avançado do fluxo (Edital > TR > ETP), ex.: "TR emitido (1ª emissão)". null = nenhum emitido.
 * Derivado só do ledger de emissões — nunca da etapa registrada.
 */
export function latestOfficialSummary(versions: OfficialVersions | null | undefined, emissions?: OfficialEmissions | null): string | null {
  for (const kind of FLOW_DESC) {
    const v = versions?.[kind];
    if (typeof v === "number" && v > 0) return `${DOCUMENT_KIND_LABELS[kind]} emitido (${emissionOrdinalLabel(emissions?.[kind]) ?? `v${v}`})`;
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
