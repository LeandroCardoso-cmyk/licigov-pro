/**
 * SEM-061 — "Confirmar" CATMAT/CATSER só age com o ESTADO GOVERNADO à vista: a decisão VIGENTE vem do ledger
 * (`catmat_decisions`, última linha do item — `itemIntelligence.getCATMATDecisions`), nunca do rótulo `decision` do candidato
 * (heurística de sugestão). O servidor continua sendo a autoridade (sugestão real, limiar configurado, idempotência); aqui só
 * se evita oferecer um clique que o ledger já contradiz ou que o servidor recusará.
 */
export interface CurrentCatmatDecisionUI {
  decision: "confirmado" | "rejeitado" | "substituido" | "sem_correspondencia_segura";
  catmatCode: string | null;
  justification?: string | null;
  createdAt?: string | null;
}

const DECISION_LABEL: Record<CurrentCatmatDecisionUI["decision"], string> = {
  confirmado: "confirmado", rejeitado: "rejeitado", substituido: "substituído manualmente", sem_correspondencia_segura: "sem correspondência segura",
};

/** Texto da decisão vigente (ou a ausência dela) — exibido acima dos candidatos. */
export function currentDecisionText(current: CurrentCatmatDecisionUI | null | undefined, loaded: boolean): string {
  if (!loaded) return "Decisão vigente: carregando…";
  if (!current) return "Decisão vigente: nenhuma decisão registrada no ledger — a sugestão ainda não foi confirmada.";
  return `Decisão vigente (ledger): ${DECISION_LABEL[current.decision]}${current.catmatCode ? ` — ${current.catmatCode}` : ""}.`;
}

export interface ConfirmGate { enabled: boolean; reason: string | null; label: string; note: string | null }

export function confirmGate(p: {
  candidateCode: string; current: CurrentCatmatDecisionUI | null | undefined; currentLoaded: boolean;
  thresholdConfigured: boolean | undefined; pending: boolean;
}): ConfirmGate {
  const base = "Confirmar";
  if (p.pending) return { enabled: false, reason: null, label: base, note: null };
  if (!p.currentLoaded || p.thresholdConfigured === undefined) return { enabled: false, reason: "Carregando o estado governado do item…", label: base, note: null };
  if (!p.thresholdConfigured) {
    return { enabled: false, reason: "Limiar institucional não configurado: um gestor precisa configurá-lo antes de qualquer decisão de CATMAT/CATSER.", label: base, note: null };
  }
  const cur = p.current;
  if (cur && (cur.decision === "confirmado" || cur.decision === "substituido") && cur.catmatCode === p.candidateCode) {
    return { enabled: false, reason: "Este código já é a decisão vigente do item.", label: base, note: null };
  }
  if (cur) {
    return { enabled: true, reason: null, label: "Confirmar (substitui a decisão vigente)", note: `Há uma decisão vigente (${DECISION_LABEL[cur.decision]}${cur.catmatCode ? ` — ${cur.catmatCode}` : ""}); confirmar registra uma nova decisão no ledger e a substitui (a anterior fica no histórico).` };
  }
  return { enabled: true, reason: null, label: base, note: null };
}
