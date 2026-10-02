/**
 * R9 / SEM-076 — ator da timeline = o HUMANO que pediu a ação (`user:<id>`), mesmo quando a IA redigiu o conteúdo
 * (o resumo diz "rascunho"/"sugestão"). Sem solicitante identificado ⇒ "sistema" — nunca "multi_copilot".
 */
export function timelineActor(requestedByUserId: number | null | undefined): string {
  return typeof requestedByUserId === "number" && Number.isFinite(requestedByUserId) ? `user:${requestedByUserId}` : "sistema";
}
