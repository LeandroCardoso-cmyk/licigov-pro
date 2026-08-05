/**
 * PR B.2.2 — Vocabulário institucional da ingestão canônica (pt-BR).
 *
 * Fonte única da verdade para rótulos e semântica dos estados de sessão, usada por badges,
 * progresso e mensagens. Linguagem INSTITUCIONAL: o conteúdo é "extraído" (sugestão), a revisão
 * humana é obrigatória e a aprovação NÃO transforma o conteúdo em documento oficial. Evita
 * "IA decidiu", "aprovado automaticamente", "validado juridicamente".
 */

/** Estados persistidos da sessão no backend (espelham server/domain/importTypes.ts). */
export type IngestionSessionStatus =
  | "uploaded"
  | "queued"
  | "parsing"
  | "extracted"
  | "normalized"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "failed"
  | "archived";

/** Fases visíveis ao usuário (inclui fases de cliente antes da sessão existir + derivadas). */
export type IngestionPhase =
  | "idle"
  | "preparing"          // calculando checksum/criando sessão (cliente)
  | "uploading"          // enviando bytes (cliente)
  | "uploaded"
  | "queued"
  | "processing"         // parsing/extracted/normalized
  | "awaiting_review"
  | "partially_reviewed" // derivado: há revisados e pendentes
  | "reviewed"           // derivado: zero pendentes, ainda não aprovado
  | "approved"
  | "rejected"
  | "failed"
  | "dlq"                // derivado: failed com tentativas esgotadas
  | "archived";

export type IngestionTone = "neutral" | "info" | "progress" | "review" | "success" | "warning" | "danger";

export interface PhaseMeta {
  label: string;
  description: string;
  tone: IngestionTone;
  /** Estado de trabalho em andamento (spinner/indeterminado). */
  busy: boolean;
  /** Estado terminal (não haverá mais transições automáticas). */
  terminal: boolean;
}

export const PHASE_META: Record<IngestionPhase, PhaseMeta> = {
  idle:               { label: "Pronto",                description: "Selecione um arquivo ou cole o conteúdo para iniciar.", tone: "neutral",  busy: false, terminal: false },
  preparing:          { label: "Preparando",            description: "Calculando integridade e criando a sessão de ingestão.", tone: "info",     busy: true,  terminal: false },
  uploading:          { label: "Enviando",              description: "Enviando o arquivo com segurança para processamento.",   tone: "progress", busy: true,  terminal: false },
  uploaded:           { label: "Enviado",               description: "Arquivo recebido. Aguardando início do processamento.",  tone: "progress", busy: true,  terminal: false },
  queued:             { label: "Na fila",               description: "Na fila de processamento.",                              tone: "progress", busy: true,  terminal: false },
  processing:         { label: "Processando",           description: "Extraindo o conteúdo do arquivo (sugestões).",           tone: "progress", busy: true,  terminal: false },
  awaiting_review:    { label: "Aguardando revisão",    description: "Conteúdo extraído. Revisão humana necessária.",          tone: "review",   busy: false, terminal: false },
  partially_reviewed: { label: "Parcialmente revisado", description: "Ainda há itens pendentes de revisão.",                   tone: "review",   busy: false, terminal: false },
  reviewed:           { label: "Revisado",              description: "Todos os itens revisados. Pronto para aprovar a revisão.", tone: "review", busy: false, terminal: false },
  approved:           { label: "Revisão aprovada",      description: "Revisão aprovada. A incorporação ao processo ocorre em etapa posterior.", tone: "success", busy: false, terminal: true },
  rejected:           { label: "Rejeitado",             description: "A sessão foi rejeitada.",                                tone: "warning",  busy: false, terminal: true },
  failed:             { label: "Falhou",                description: "O processamento falhou. É possível tentar novamente.",   tone: "danger",   busy: false, terminal: false },
  dlq:                { label: "Enviado para DLQ",      description: "Tentativas esgotadas. Encaminhado para análise (DLQ).",  tone: "danger",   busy: false, terminal: true },
  archived:           { label: "Arquivado",             description: "Sessão arquivada.",                                      tone: "neutral",  busy: false, terminal: true },
};

const MAX_RETRIES = 3;

/**
 * Deriva a fase visível a partir do estado da sessão + resumo de staging + tentativas.
 * `pending`/`total` vêm do resumo de staging (getSessionStatus.staging).
 */
export function derivePhase(input: {
  status: IngestionSessionStatus;
  pending?: number;
  total?: number;
  retryCount?: number;
}): IngestionPhase {
  const { status, pending = 0, total = 0, retryCount = 0 } = input;
  switch (status) {
    case "uploaded":   return "uploaded";
    case "queued":     return "queued";
    case "parsing":
    case "extracted":
    case "normalized": return "processing";
    case "awaiting_review":
      if (total > 0 && pending === 0) return "reviewed";
      if (total > 0 && pending < total) return "partially_reviewed";
      return "awaiting_review";
    case "approved":   return "approved";
    case "rejected":   return "rejected";
    case "failed":     return retryCount >= MAX_RETRIES ? "dlq" : "failed";
    case "archived":   return "archived";
    default:           return "idle";
  }
}

/** Tailwind (tokens semânticos + tema-aware) para cada tom, usado por badges. */
export const TONE_BADGE_CLASS: Record<IngestionTone, string> = {
  neutral:  "bg-muted text-muted-foreground border-border",
  info:     "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900",
  progress: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-900",
  review:   "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  success:  "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900",
  warning:  "bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-900",
  danger:   "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900",
};

/** Rótulos institucionais reutilizáveis (evitam linguagem imprópria). */
export const INSTITUTIONAL_COPY = {
  extractedContent: "Conteúdo extraído",
  reviewNeeded: "Revisão necessária",
  extractionConfidence: "Confiança da extração",
  dataOrigin: "Origem do dado",
  warnings: "Advertências",
  reviewApproval: "Aprovação da revisão",
  humanReviewRequired: "A revisão humana é obrigatória. As linhas abaixo são sugestões extraídas do arquivo.",
  notOfficialYet:
    "Aprovar a revisão NÃO transforma o conteúdo em documento oficial. A incorporação ao processo ocorrerá em etapa posterior.",
} as const;
