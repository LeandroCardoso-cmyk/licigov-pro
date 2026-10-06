/**
 * Política PURA de entrada do LIMIAR institucional de CATMAT/CATSER (fail-closed).
 * Extraída para ser determinística e testável — sem React/tRPC.
 *
 * Regras (espelham o backend `setCATMATThreshold`, `minScore ∈ [0,1]`, `reason` ≥ 3):
 *  - o percentual é digitado em 0–100 e convertido para score 0–1;
 *  - entrada inválida (vazia, fora de faixa, justificativa curta) → NÃO produz payload
 *    (a UI não dispara a mutation) — nunca há default silencioso.
 */

export interface CatmatThresholdInput {
  readonly minScore: number;
  readonly reason: string;
}

export type CatmatThresholdParse =
  | { readonly ok: true; readonly value: CatmatThresholdInput }
  | { readonly ok: false; readonly error: string };

/** Valida e normaliza a entrada humana do limiar. Fail-closed: sem número válido → recusa. */
export function parseThresholdInput(percentRaw: string, reasonRaw: string): CatmatThresholdParse {
  const trimmed = String(percentRaw).trim();
  // Vazio NÃO vira 0 (Number("") === 0): sem valor explícito, recusa — fail-closed, nunca default.
  if (trimmed.length === 0) return { ok: false, error: "Informe um score entre 0 e 100." };
  const pct = Number(trimmed);
  if (!Number.isFinite(pct)) return { ok: false, error: "Informe um score entre 0 e 100." };
  if (pct < 0 || pct > 100) return { ok: false, error: "O score deve estar entre 0 e 100." };
  const reason = reasonRaw.trim();
  if (reason.length < 3) return { ok: false, error: "Informe uma justificativa (mín. 3 caracteres)." };
  return { ok: true, value: { minScore: pct / 100, reason } };
}

// ─── SEM-061 — confirmação do IMPACTO ORG-WIDE antes de trocar o limiar ────────────────────────

/** Prévia devolvida por `itemIntelligence.previewCATMATThresholdChange` (somente leitura; não decide política). */
export interface CatmatThresholdPreviewUI {
  current: { minScore: number; version: number } | null;
  proposedMinScore: number;
  impact: {
    itemsWithCurrentDecision: number;
    byDecision: Record<"confirmado" | "rejeitado" | "substituido" | "sem_correspondencia_segura", number>;
    currentDecisionsUnderOtherThreshold: number;
    currentDecisionsWithoutRecordedThreshold: number;
    totalLedgerEntries: number;
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Linhas exibidas ANTES da confirmação: vigente → proposto, alcance (órgão inteiro) e o que NÃO muda. */
export function thresholdImpactLines(p: CatmatThresholdPreviewUI): string[] {
  const i = p.impact;
  const lines = [
    p.current
      ? `Limiar vigente: ${pct(p.current.minScore)} (v${p.current.version}) → proposto: ${pct(p.proposedMinScore)}.`
      : `Nenhum limiar configurado → proposto: ${pct(p.proposedMinScore)}.`,
    "Alcance: toda a organização — vale para as próximas decisões CATMAT/CATSER de todos os processos e itens.",
    `Decisões vigentes hoje: ${i.itemsWithCurrentDecision} item(ns) (confirmado: ${i.byDecision.confirmado}, substituído: ${i.byDecision.substituido}, rejeitado: ${i.byDecision.rejeitado}, sem correspondência segura: ${i.byDecision.sem_correspondencia_segura}).`,
    `Dessas, ${i.currentDecisionsUnderOtherThreshold} foi(ram) tomada(s) sob limiar diferente do proposto${i.currentDecisionsWithoutRecordedThreshold ? ` e ${i.currentDecisionsWithoutRecordedThreshold} sem limiar registrado` : ""}.`,
    "As decisões já registradas não são reavaliadas nem alteradas (ledger imutável); a versão anterior do limiar fica preservada (inativa).",
  ];
  return lines;
}

/** A troca só é enviada depois da prévia exibida E de confirmação explícita (nunca no primeiro clique). */
export function canSubmitThresholdChange(p: { previewShownFor: number | null; proposed: number; confirmed: boolean; pending: boolean }): boolean {
  return !p.pending && p.confirmed && p.previewShownFor !== null && Math.abs(p.previewShownFor - p.proposed) < 1e-9;
}
