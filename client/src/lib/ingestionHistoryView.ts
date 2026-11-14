/**
 * M8 (homologação visual) — apresentação PURA do histórico de ingestão e da proveniência de cotações (sem React/rede).
 * Rótulos fechados: valor desconhecido aparece como veio (nada é inventado).
 */

export interface SessionHistoryView {
  id: number;
  importType: string | null;
  status: string;
  sourceFileName: string;
  sourceSize: number | null;
  checksumPrefix: string | null;
  createdAt: string;
  finishedAt: string | null;
  uploadedBy: { userId: number; name: string | null };
  approval: { userId: number; name: string | null; at: string } | null;
  promotion: { userId: number | null; name: string | null; at: string | null; researchId: string | null; status: string | null } | null;
}

const SESSION_STATUS: Readonly<Record<string, string>> = {
  uploaded: "Arquivo enviado", queued: "Na fila", parsing: "Lendo arquivo", extracted: "Extraído", normalized: "Normalizado",
  awaiting_review: "Aguardando revisão", approved: "Aprovada", rejected: "Rejeitada", failed: "Falhou", archived: "Arquivada",
};
export const sessionStatusLabel = (s: string): string => SESSION_STATUS[s] ?? s;

const PROVENANCE: Readonly<Record<string, { label: string; tone: "warn" | "ok" | "neutral" }>> = {
  ficticia: { label: "Fictícia (não oficial)", tone: "warn" },
  declarada: { label: "Declarada", tone: "neutral" },
  verificada: { label: "Verificada", tone: "ok" },
};
/** Proveniência registrada da cotação; ausente (dado legado) ⇒ "não classificada" — nunca presumida. */
export function provenanceLabel(kind: string | null | undefined): { label: string; tone: "warn" | "ok" | "neutral" } {
  if (!kind) return { label: "Proveniência não classificada", tone: "neutral" };
  return PROVENANCE[kind] ?? { label: kind, tone: "neutral" };
}

const RISK_TYPE: Readonly<Record<string, string>> = {
  baixa_competitividade: "Baixa competitividade",
  fonte_ficticia: "Fonte fictícia",
  preco_fora_da_curva: "Preço fora da curva",
  especificacao: "Especificação",
};
export const riskTypeLabel = (t: string): string => RISK_TYPE[t] ?? t;

const SEVERITY: Readonly<Record<string, string>> = { baixo: "Baixa", medio: "Média", alto: "Alta", critico: "Crítica" };
export const severityLabel = (s: string): string => SEVERITY[s] ?? s;

/**
 * Pesquisa de Preços gerada → sessão de ingestão que a originou (promoção registrada). Permite ao servidor localizar
 * o arquivo de origem de uma cotação (`supplier.researchId`).
 */
export function sessionByResearchId(sessions: readonly SessionHistoryView[]): Map<string, SessionHistoryView> {
  const out = new Map<string, SessionHistoryView>();
  for (const s of sessions) if (s.promotion?.researchId) out.set(s.promotion.researchId, s);
  return out;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
