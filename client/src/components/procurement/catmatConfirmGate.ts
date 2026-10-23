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

/**
 * M8 hardening — estado da SUGESTÃO (servidor). Verificação oficial ≠ recomendação atual ≠ decisão (ledger):
 * A = candidato da busca atual; B = histórico; C = código informado e verificado; legado = origem não registrada.
 */
export type SuggestionStateUI = "busca_atual" | "historico" | "codigo_verificado" | "origem_nao_identificada";

export const SUGGESTION_STATE_LABEL: Record<SuggestionStateUI, string> = {
  busca_atual: "Candidato da busca atual",
  codigo_verificado: "Código informado e verificado",
  historico: "Histórico — não retornou na busca mais recente",
  origem_nao_identificada: "Sugestão anterior — origem da busca não registrada",
};

/** Só candidatos da busca atual e códigos informados/verificados podem ser confirmados (o servidor impõe o mesmo). */
export function isPastSuggestion(state: SuggestionStateUI | undefined): boolean {
  return state !== "busca_atual" && state !== "codigo_verificado";
}

export function confirmGate(p: {
  candidateCode: string; current: CurrentCatmatDecisionUI | null | undefined; currentLoaded: boolean;
  thresholdConfigured: boolean | undefined; pending: boolean;
  /** Verificação no catálogo oficial (servidor). `false` ⇒ nunca confirmável como classificação oficial. */
  verified?: boolean;
  verificationNote?: string | null;
  /** Estado da sugestão (servidor); ausente ⇒ tratado como não atual (fail-closed, como no servidor). */
  state?: SuggestionStateUI;
}): ConfirmGate {
  const base = "Confirmar";
  if (p.pending) return { enabled: false, reason: null, label: base, note: null };
  if (p.verified === false) {
    return {
      enabled: false, label: base, note: null,
      reason: `Sem verificação no catálogo oficial${p.verificationNote ? ` (${p.verificationNote})` : ""} — use "Buscar classificação"; a confirmação só vale para códigos oficiais.`,
    };
  }
  if (isPastSuggestion(p.state)) {
    return {
      enabled: false, label: base, note: null,
      reason: "Não pertence à busca oficial mais recente — a verificação oficial não a torna recomendação atual. Use \"Buscar classificação\" novamente ou informe o código em \"Verificar código\".",
    };
  }
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
