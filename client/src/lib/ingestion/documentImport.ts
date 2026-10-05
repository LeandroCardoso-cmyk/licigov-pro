/**
 * P0 piloto — Lógica PURA da importação documental (DFD/ETP/TR) no cliente (testável sem DOM).
 */
import type { IngestionCapabilities } from "./capabilities";

export type DocumentKind = "dfd" | "etp" | "tr";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = { dfd: "DFD", etp: "ETP", tr: "TR" };

/**
 * Documento só entra por PDF (com texto) ou DOCX — o servidor recusa .doc (Word 97-2003) e OCR não existe
 * nesta versão. Restringe a capacidade real (parserRegistry) a esses formatos, sem ofertar outros.
 */
export function documentImportCapabilities(caps: IngestionCapabilities | undefined): IngestionCapabilities | undefined {
  if (!caps) return undefined;
  const formats = caps.formats
    .filter((f) => f.key === "pdf" || f.key === "docx")
    .map((f) => f.key === "docx"
      ? { ...f, extensions: f.extensions.filter((e) => e !== ".doc"), mimeTypes: f.mimeTypes.filter((m) => m !== "application/msword") }
      : f);
  return { ...caps, formats, supportedFormats: formats.filter((f) => f.supported) };
}

/**
 * Etapa visível (1..4): 1 enviar · 2 revisar · 3 aprovar · 4 promover. Deriva do estado PERSISTIDO
 * (sessão + staging documental), então sobrevive a reload.
 */
export function documentImportStep(p: { sessionStatus: string | null; stagingStatus: string | null; busy: boolean }): 1 | 2 | 3 | 4 {
  if (p.stagingStatus === "approved") return 4;
  if (p.stagingStatus === "promoted") return 4;
  if (p.stagingStatus === "pending_review") return 2;
  return 1;
}

/** Rótulo da origem do rascunho canônico para a UI (importado ≡ gerado a jusante). */
export function draftOriginLabel(origin: string | null | undefined): string | null {
  if (origin === "import") return "importado e revisado";
  if (origin === "manual") return "editado manualmente";
  if (origin === "generated") return "gerado com IA supervisionada";
  return null;
}

// ─── SEM-061 — "Substituir rascunho" mostra o que será substituído ──────────────────────────────

/** Rascunho vigente como o servidor o descreve (tamanho, data, origem, última edição e prévia). */
export interface CurrentDraftSummary {
  exists: boolean;
  contentHash: string | null;
  origin: "import" | "generated" | "manual" | null;
  title: string | null;
  contentLength: number | null;
  preview: string | null;
  previewTruncated: boolean;
  updatedAt: string | null;
  lastEdit: { operation: string; actorUserId: number; at: string } | null;
}

const LAST_EDIT_LABELS: Record<string, string> = {
  import_promote: "importação de documento", import_replace: "substituição por documento importado",
  dfd_manual_edit: "edição manual", human_edit: "edição manual", ai_regenerate: "regeneração por IA",
  dfd_regenerate: "criação automática do DFD", dfd_context_reconcile: "atualização de campo a partir da origem",
  dfd_ai_draft: "rascunho de IA", dfd_ai_accept: "sugestão de IA aceita por servidor",
};

export function formatCharCount(n: number | null | undefined): string {
  return typeof n === "number" ? `${n.toLocaleString("pt-BR")} caracteres` : "tamanho desconhecido";
}

export function formatDateTimeBR(iso: string | null | undefined): string {
  if (!iso) return "data desconhecida";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "data desconhecida" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export interface ReplaceSideSummary { title: string; facts: Array<{ label: string; value: string }>; preview: string | null; truncated: boolean }

/** O que "Substituir rascunho" vai trocar: conteúdo atual (origem, última alteração, tamanho, prévia). Nunca vazio. */
export function currentDraftReplaceSummary(draft: CurrentDraftSummary, label: string): ReplaceSideSummary {
  const lastEdit = draft.lastEdit ? (LAST_EDIT_LABELS[draft.lastEdit.operation] ?? draft.lastEdit.operation) : null;
  return {
    title: `Rascunho atual do ${label} (será substituído)`,
    facts: [
      { label: "Origem", value: draftOriginLabel(draft.origin) ?? "origem não registrada" },
      { label: "Última alteração", value: `${formatDateTimeBR(draft.lastEdit?.at ?? draft.updatedAt)}${lastEdit ? ` — ${lastEdit}` : ""}` },
      { label: "Tamanho", value: formatCharCount(draft.contentLength) },
    ],
    preview: draft.preview,
    truncated: draft.previewTruncated,
  };
}

/** O documento importado (já aprovado) que entra no lugar. */
export function incomingDocumentSummary(staging: { originalFileName: string; content: string; approvedAt: string | null }, label: string): ReplaceSideSummary {
  const PREVIEW = 1200;
  return {
    title: `${label} importado (novo rascunho)`,
    facts: [
      { label: "Arquivo", value: staging.originalFileName },
      { label: "Aprovado em", value: formatDateTimeBR(staging.approvedAt) },
      { label: "Tamanho", value: formatCharCount(staging.content.length) },
    ],
    preview: staging.content.slice(0, PREVIEW),
    truncated: staging.content.length > PREVIEW,
  };
}

/** A substituição só pode ser confirmada com o conteúdo atual À VISTA (hash do instante em que foi exibido). */
export function canConfirmReplace(p: { draft: Pick<CurrentDraftSummary, "contentHash" | "preview">; reason: string; pending: boolean }): boolean {
  return !p.pending && !!p.draft.contentHash && p.draft.preview !== null && p.reason.trim().length >= 5;
}
