/**
 * LICIGOV-FAST PR-1 — jornada documental DFD → ETP → TR → Edital (regra pura, sem React/rede).
 *
 * Deriva o estado de cada documento SÓ do que o processo já carrega (`loadProcess`: rascunhos em
 * `generated_documents` + ledger de emissões). Não persiste nada, não cria máquina de estados paralela e
 * não toca a etapa registrada do processo: navegar entre etapas é só trocar a aba.
 *
 * Minuta ≠ documento oficial: o rascunho é sempre "minuta"; "emitido" vem exclusivamente do ledger de
 * emissões (versão oficial imutável). O status do rascunho "aprovado" continua sendo minuta.
 */
import { officialVersionLabel, type OfficialEmissions, type OfficialVersions } from "./processDocumentStatus";
import { UNISSUED_DRAFT_MARKING } from "@shared/documentMarkers";

export const JOURNEY_KINDS = ["dfd", "etp", "tr", "edital"] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];

export const JOURNEY_LABELS: Readonly<Record<JourneyKind, { short: string; long: string }>> = {
  dfd: { short: "DFD", long: "Documento de Formalização da Demanda" },
  etp: { short: "ETP", long: "Estudo Técnico Preliminar" },
  tr: { short: "TR", long: "Termo de Referência" },
  edital: { short: "Edital", long: "Edital" },
};

export function isJourneyKind(value: string): value is JourneyKind {
  return (JOURNEY_KINDS as readonly string[]).includes(value);
}

/** absent = sem documento · draft/review = minuta · official = há versão emitida (ledger). */
export type JourneyDocPhase = "absent" | "draft" | "review" | "official";

export type JourneyDocState = {
  kind: JourneyKind;
  phase: JourneyDocPhase;
  /** Rótulo curto exibido no passo da jornada. */
  label: string;
  /** Há conteúdo para visualizar/exportar (rascunho existente). */
  exportable: boolean;
  /** Situação persistida do rascunho (`generated_documents.status`), null sem rascunho. */
  draftStatus: string | null;
};

const DRAFT_LABELS: Readonly<Record<string, string>> = {
  rascunho: "Minuta (rascunho)",
  em_revisao: "Minuta em revisão",
  aprovado: "Minuta revisada",
  rejeitado: "Minuta rejeitada",
};

/**
 * Estado real de um documento da jornada. Documento inexistente nunca aparece como concluído; o status do
 * rascunho (mesmo "aprovado"/"emitido") nunca vira "oficial" — só o ledger de emissões diz isso.
 */
export function journeyDocState(
  kind: JourneyKind,
  documents: ReadonlyArray<{ kind: string; status: string }> | null | undefined,
  officialVersions?: OfficialVersions | null,
  officialEmissions?: OfficialEmissions | null,
): JourneyDocState {
  const doc = documents?.find((d) => d.kind === kind) ?? null;
  const official = officialVersionLabel(officialVersions, kind, officialEmissions);
  const draftStatus = doc?.status ?? null;
  if (official) return { kind, phase: "official", label: official, exportable: !!doc, draftStatus };
  if (!doc) return { kind, phase: "absent", label: "Não iniciado", exportable: false, draftStatus };
  if (doc.status === "em_revisao") return { kind, phase: "review", label: DRAFT_LABELS.em_revisao, exportable: true, draftStatus };
  return { kind, phase: "draft", label: DRAFT_LABELS[doc.status] ?? "Minuta (rascunho)", exportable: true, draftStatus };
}

/** Situação que o exportador canônico imprime no cabeçalho do arquivo do rascunho (espelha o router). */
const FILE_STATUS_LABELS: Readonly<Record<string, string>> = {
  rascunho: "RASCUNHO", em_revisao: "EM REVISÃO", aprovado: "APROVADO", rejeitado: "REJEITADO",
};

/**
 * Nota sobre o arquivo que será exportado — diz exatamente o que o arquivo mostra. Todo arquivo que não é a versão emitida
 * (ledger) sai identificado como MINUTA — NÃO EMITIDA OFICIALMENTE na 1ª página e no rodapé de todas as páginas, com a
 * situação interna do rascunho preservada no cabeçalho. A versão emitida sai sem marca de minuta.
 */
export function exportNote(state: JourneyDocState): string {
  if (!state.exportable) return "Ainda não há minuta deste documento para visualizar ou exportar.";
  const status = state.draftStatus ?? "rascunho";
  const draftFile = `sai identificado como “${UNISSUED_DRAFT_MARKING}” na 1ª página e no rodapé de todas as páginas`
    + `, com a situação interna “${FILE_STATUS_LABELS[status] ?? status.toUpperCase()}” no cabeçalho`;
  if (state.phase === "official") {
    return `Há versão emitida. Se a minuta não mudou desde a emissão, o arquivo é a versão oficial (sem marca de minuta); se mudou, ${draftFile}.`;
  }
  return `O arquivo ${draftFile}.`;
}

export function journeyStates(
  documents: ReadonlyArray<{ kind: string; status: string }> | null | undefined,
  officialVersions?: OfficialVersions | null,
  officialEmissions?: OfficialEmissions | null,
): JourneyDocState[] {
  return JOURNEY_KINDS.map((k) => journeyDocState(k, documents, officialVersions, officialEmissions));
}

/** Próximo documento do fluxo (null no Edital). Sem bloqueio: o próximo é sempre acessível. */
export function nextJourneyKind(current: JourneyKind): JourneyKind | null {
  const i = JOURNEY_KINDS.indexOf(current);
  return i >= 0 && i < JOURNEY_KINDS.length - 1 ? JOURNEY_KINDS[i + 1] : null;
}

/** Texto da ação contextual para o próximo documento, com o estado real dele. */
export function nextActionLabel(next: JourneyDocState): string {
  const name = JOURNEY_LABELS[next.kind].short;
  return next.phase === "absent" ? `Ir para ${name} (não iniciado)` : `Ir para ${name}`;
}

// ── Exportação individual ────────────────────────────────────────────────────

/** view/print abrem o PDF no navegador (inline); docx/pdf baixam o arquivo (attachment). */
export type JourneyExportAction = "view" | "docx" | "pdf" | "print";

export type ExportRequest = { format: "docx" | "pdf"; disposition: "attachment" | "inline"; opensTab: boolean };

/** Mapeia a ação ao contrato canônico `procurementProcess.exportDocument` (sem exportador próprio). */
export function exportRequestFor(action: JourneyExportAction): ExportRequest {
  switch (action) {
    case "docx": return { format: "docx", disposition: "attachment", opensTab: false };
    case "pdf": return { format: "pdf", disposition: "attachment", opensTab: false };
    case "view":
    case "print": return { format: "pdf", disposition: "inline", opensTab: true };
  }
}

/** Texto mostrado na aba aberta enquanto o PDF é preparado (diz exatamente o que será aberto). */
export function exportPlaceholderText(kind: JourneyKind, action: JourneyExportAction): string {
  const doc = `${JOURNEY_LABELS[kind].short} — ${JOURNEY_LABELS[kind].long}`;
  return action === "print"
    ? `Preparando o PDF de ${doc} para impressão. Quando abrir, use o botão Imprimir do visualizador (ou Ctrl+P): só este documento será impresso.`
    : `Preparando o PDF de ${doc} para visualização…`;
}

/** Confirmação depois que o arquivo foi entregue ao navegador (sem prometer o que o navegador não controla). */
export function exportDoneMessage(kind: JourneyKind, action: JourneyExportAction): string {
  const name = JOURNEY_LABELS[kind].short;
  switch (action) {
    case "print": return `PDF do ${name} aberto em nova aba. Use Imprimir no visualizador (Ctrl+P) — só este documento será impresso.`;
    case "view": return `PDF do ${name} aberto em nova aba.`;
    case "docx": return `Download do DOCX do ${name} iniciado.`;
    case "pdf": return `Download do PDF do ${name} iniciado.`;
  }
}

export const EXPORT_TAB_BLOCKED_MESSAGE =
  "O navegador bloqueou a nova aba. Permita pop-ups para este site ou use “Baixar PDF”.";

/** Aba pré-aberta no clique (antes da chamada assíncrona), para o navegador não a bloquear. */
export type ExportTab = { location: { href: string }; closed?: boolean; close?: () => void };

export type ExportDeliveryDeps = {
  /** Abre uma URL em nova aba (fallback quando não houve aba pré-aberta). */
  openTab: (url: string) => ExportTab | null;
  /** Baixa o arquivo sem sair da página (Content-Disposition: attachment). */
  download: (url: string, fileName: string) => void;
};

/**
 * Entrega a URL assinada devolvida pelo exportador canônico: download no lugar, ou PDF inline na aba
 * pré-aberta (ou numa nova aba). "blocked" = o navegador não deixou abrir — quem chama avisa, sem fingir sucesso.
 */
export function deliverExport(
  result: { url: string; fileName: string },
  request: ExportRequest,
  tab: ExportTab | null,
  deps: ExportDeliveryDeps,
): "delivered" | "blocked" {
  if (!request.opensTab) {
    deps.download(result.url, result.fileName);
    return "delivered";
  }
  if (tab && !tab.closed) {
    tab.location.href = result.url;
    return "delivered";
  }
  return deps.openTab(result.url) ? "delivered" : "blocked";
}

/** O arquivo sai do conteúdo SALVO: com edição pendente, o usuário é avisado antes de exportar. */
export const UNSAVED_EXPORT_NOTE = "Há alterações não salvas: o arquivo usa o último conteúdo salvo.";

/** Mensagem de confirmação ao sair de uma etapa com edição não salva (cancelar = permanecer). */
export function unsavedLeaveMessage(kind: JourneyKind): string {
  return `Há alterações não salvas no ${JOURNEY_LABELS[kind].short}. Se sair agora, elas serão perdidas. Deseja sair sem salvar?`;
}

/**
 * Decide se a navegação pode prosseguir. Sem edição pendente ⇒ segue sem perguntar; com edição pendente ⇒
 * só segue se o usuário confirmar (cancelar mantém a etapa e o texto).
 */
export function canLeaveStage(dirtyKind: JourneyKind | null, confirm: (message: string) => boolean): boolean {
  if (!dirtyKind) return true;
  return confirm(unsavedLeaveMessage(dirtyKind));
}

export type JourneyExportRunDeps = {
  /** Chamada ao contrato canônico `procurementProcess.exportDocument`. */
  exportDocument: (input: { format: "docx" | "pdf"; disposition: "attachment" | "inline" }) => Promise<{ url: string; fileName: string }>;
  /** Abre (no clique) a aba que receberá o PDF, já com o texto do que está sendo preparado. */
  openPlaceholderTab: (text: string) => (ExportTab & { close: () => void }) | null;
  delivery: ExportDeliveryDeps;
  notify: { success: (message: string) => void; error: (message: string) => void };
};

/**
 * Fluxo completo de uma ação de exportação: abre a aba no gesto (se for o caso), chama o exportador canônico,
 * entrega o arquivo e avisa. Em erro fecha a aba pré-aberta e mostra a falha — nunca simula sucesso.
 */
export async function runJourneyExport(kind: JourneyKind, action: JourneyExportAction, deps: JourneyExportRunDeps): Promise<"delivered" | "blocked" | "failed"> {
  const request = exportRequestFor(action);
  const tab = request.opensTab ? deps.openPlaceholderTab(exportPlaceholderText(kind, action)) : null;
  try {
    const result = await deps.exportDocument({ format: request.format, disposition: request.disposition });
    const outcome = deliverExport(result, request, tab, deps.delivery);
    if (outcome === "blocked") deps.notify.error(EXPORT_TAB_BLOCKED_MESSAGE);
    else deps.notify.success(exportDoneMessage(kind, action));
    return outcome;
  } catch (e) {
    tab?.close();
    deps.notify.error("Falha ao exportar: " + (e instanceof Error ? e.message : "erro desconhecido"));
    return "failed";
  }
}
