/**
 * M8 pós-homologação — acompanhamento da GERAÇÃO de rascunho (ETP/TR) quando a resposta não chega.
 *
 * Observado em staging: a geração do TR leva ~30 s; a rede cortou a 1ª requisição (sem resposta), o novo clique com a MESMA chave
 * recebeu CONFLICT "em processamento" e a tela mostrou erro — mas o servidor concluiu e gravou o rascunho (uma única vez). Aqui:
 *  - só o CONFLICT de "em processamento" (reserva de idempotência em voo) e o erro SEM código (rede/proxy: desfecho desconhecido)
 *    viram ACOMPANHAMENTO — pela LEITURA canônica do rascunho (`reviewableDraft`), nunca reenviando a mutação;
 *  - conflito real (hash divergente, conteúdo humano, payload diferente) e recusa de documento oficial continuam ERRO, com a
 *    mensagem do servidor;
 *  - o polling é limitado (intervalo e teto); ao vencer, a tela diz que pode ainda estar processando e oferece "Verificar novamente".
 * A chave de idempotência é preservada enquanto se acompanha (a próxima tentativa explícita é a MESMA tentativa lógica).
 */
import { useCallback, useEffect, useState } from "react";
import { isProcessingConflict } from "./catmatKeyPolicy";

export const GENERATION_POLL_INTERVAL_MS = 3_000;
export const GENERATION_FOLLOW_UP_LIMIT_MS = 120_000;

/** Prefixo de domínio do CONFLICT "geração idêntica em processamento" (server/services/procurementProcessService.ts). */
export const GENERATION_IN_PROGRESS_PREFIX = "GENERATION_IN_PROGRESS:";

export type GenerationErrorPlan = "follow" | "error";

/** Decisão PURA sobre um erro da mutação de geração: acompanhar (desfecho em voo/desconhecido) ou mostrar o erro. */
export function generationFollowUp(code: string | null | undefined, message: string | null | undefined): GenerationErrorPlan {
  const msg = message ?? "";
  if (msg.startsWith(GENERATION_IN_PROGRESS_PREFIX)) return "follow";
  if (isProcessingConflict(code, msg)) return "follow";
  // Sem código tRPC: a resposta não chegou (corte de rede/proxy, 499/502/504) — o servidor pode ter concluído.
  if (!code) return "follow";
  return "error";
}

export interface DraftMark { readonly contentHash: string | null; readonly updatedAt: string | null }

export type FollowUpStatus = "idle" | "following" | "done" | "expired";

/** Estado PURO do acompanhamento: concluído quando o rascunho persistido difere do que existia ao começar. */
export function followUpStatus(awaiting: { base: DraftMark; since: number } | null, current: DraftMark, now: number): FollowUpStatus {
  if (!awaiting) return "idle";
  const changed = current.contentHash !== awaiting.base.contentHash || current.updatedAt !== awaiting.base.updatedAt;
  if (changed && (current.contentHash !== null || current.updatedAt !== null)) return "done";
  return now - awaiting.since >= GENERATION_FOLLOW_UP_LIMIT_MS ? "expired" : "following";
}

const markOf = (d: { contentHash?: string | null; updatedAt?: string | Date | null } | null | undefined): DraftMark => ({
  contentHash: d?.contentHash ?? null,
  updatedAt: d?.updatedAt == null ? null : String(d.updatedAt instanceof Date ? d.updatedAt.toISOString() : d.updatedAt),
});

/**
 * Hook compartilhado (ETP/TR): `start(draft)` ao receber um erro de plano "follow"; `refetchInterval` para a query
 * `reviewableDraft`; `onDone` roda uma vez quando o rascunho novo aparece.
 */
export function useGenerationFollowUp(currentDraft: { contentHash?: string | null; updatedAt?: string | Date | null } | null | undefined, onDone: () => void) {
  const [awaiting, setAwaiting] = useState<{ base: DraftMark; since: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const status = followUpStatus(awaiting, markOf(currentDraft), now);

  useEffect(() => {
    if (status !== "following") return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "done") { setAwaiting(null); onDone(); }
  }, [status]);

  const start = useCallback((base: { contentHash?: string | null; updatedAt?: string | Date | null } | null | undefined) => {
    setAwaiting({ base: markOf(base), since: Date.now() });
    setNow(Date.now());
  }, []);
  const restart = useCallback(() => { setAwaiting((a) => (a ? { ...a, since: Date.now() } : a)); setNow(Date.now()); }, []);
  const clear = useCallback(() => setAwaiting(null), []);

  return {
    status,
    following: status === "following",
    expired: status === "expired",
    refetchInterval: status === "following" ? GENERATION_POLL_INTERVAL_MS : (false as const),
    start, restart, clear,
  };
}
