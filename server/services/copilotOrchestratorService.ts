/**
 * Sprint 4.9 — Copilot Orchestrator Service
 *
 * Seleciona o copiloto adequado a partir da intenção da consulta, coordena
 * múltiplos copilotos, resolve conflitos e distribui tarefas. Determinístico e
 * puro (sem I/O) — a seleção depende apenas do texto da consulta.
 */

import type { CopilotType } from "../domain/institutionalCopilot";
import { ALL_COPILOT_TYPES } from "../domain/institutionalCopilot";

export interface CopilotSelection {
  readonly copilotType: CopilotType;
  readonly score: number;
  readonly rationale: string;
}

/** Palavras-chave por domínio de copiloto (ordem = prioridade de desempate). */
const INTENT_KEYWORDS: Array<{ copilotType: CopilotType; keywords: string[] }> = [
  { copilotType: "pregoeiro", keywords: ["pregão", "pregao", "disputa", "lance", "sessão pública", "habilitação", "julgamento", "recurso"] },
  { copilotType: "planejamento", keywords: ["dfd", "etp", "pca", "planejamento", "plano de contratações", "matriz de risco", "estudo técnico", "formalização da demanda"] },
  { copilotType: "tr_intelligence", keywords: ["termo de referência", "tr", "especificação", "requisito", "catmat", "catser", "padronização", "cláusula técnica"] },
  { copilotType: "juridico", keywords: ["jurídico", "juridico", "jurisprudência", "acórdão", "acordao", "parecer", "fundamentação legal", "legalidade", "lei 14.133"] },
  { copilotType: "pesquisa_precos", keywords: ["preço", "preco", "pesquisa de preços", "estimativa", "cotação", "cotacao", "valor de referência", "orçamento"] },
  { copilotType: "contratos", keywords: ["contrato", "aditivo", "prorrogação", "prorrogacao", "fiscalização", "fiscalizacao", "execução contratual", "reequilíbrio"] },
  { copilotType: "controle_interno", keywords: ["controle interno", "auditoria", "compliance", "conformidade", "controle", "risco de integridade"] },
  { copilotType: "agente_contratacao", keywords: ["contratação", "contratacao", "licitação", "licitacao", "procedimento", "governança", "conformidade documental"] },
];

/** Seleciona o copiloto mais aderente à consulta (default: agente_contratacao). */
export function selectCopilot(query: string): CopilotSelection {
  const q = query.toLowerCase();
  let best: CopilotSelection = {
    copilotType: "agente_contratacao",
    score: 0,
    rationale: "Seleção padrão: Agente de Contratação (nenhum domínio específico dominante).",
  };

  for (const entry of INTENT_KEYWORDS) {
    let hits = 0;
    const matched: string[] = [];
    for (const kw of entry.keywords) {
      if (q.includes(kw)) { hits++; matched.push(kw); }
    }
    const score = entry.keywords.length > 0 ? hits / entry.keywords.length : 0;
    if (hits > 0 && score > best.score) {
      best = {
        copilotType: entry.copilotType,
        score,
        rationale: `Selecionado por aderência de intenção (termos: ${matched.join(", ")}).`,
      };
    }
  }

  return best;
}

/** Retorna os N copilotos mais aderentes, ordenados por score (coordenação). */
export function rankCopilots(query: string, topN = 3): CopilotSelection[] {
  const q = query.toLowerCase();
  const scored: CopilotSelection[] = [];
  for (const entry of INTENT_KEYWORDS) {
    let hits = 0;
    for (const kw of entry.keywords) if (q.includes(kw)) hits++;
    const score = entry.keywords.length > 0 ? hits / entry.keywords.length : 0;
    if (hits > 0) {
      scored.push({ copilotType: entry.copilotType, score, rationale: `${hits} termo(s) do domínio ${entry.copilotType}.` });
    }
  }
  scored.sort((a, b) => b.score - a.score || ALL_COPILOT_TYPES.indexOf(a.copilotType) - ALL_COPILOT_TYPES.indexOf(b.copilotType));
  if (scored.length === 0) {
    return [{ copilotType: "agente_contratacao", score: 0, rationale: "Fallback." }];
  }
  return scored.slice(0, topN);
}

export interface CopilotConflict {
  readonly copilotA: CopilotType;
  readonly copilotB: CopilotType;
  readonly reason: string;
}

/**
 * Resolve conflitos quando múltiplos copilotos disputam a mesma consulta:
 * mantém o de maior score; empate é resolvido pela prioridade de registro.
 */
export function resolveConflicts(selections: CopilotSelection[]): {
  winner: CopilotSelection;
  conflicts: CopilotConflict[];
} {
  if (selections.length === 0) {
    return {
      winner: { copilotType: "agente_contratacao", score: 0, rationale: "Fallback." },
      conflicts: [],
    };
  }
  const sorted = [...selections].sort(
    (a, b) => b.score - a.score || ALL_COPILOT_TYPES.indexOf(a.copilotType) - ALL_COPILOT_TYPES.indexOf(b.copilotType),
  );
  const winner = sorted[0];
  const conflicts: CopilotConflict[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].score - winner.score) < 0.15) {
      conflicts.push({
        copilotA: winner.copilotType,
        copilotB: sorted[i].copilotType,
        reason: "Scores de aderência próximos — coordenação supervisionada recomendada.",
      });
    }
  }
  return { winner, conflicts };
}

export interface CopilotTask {
  readonly copilotType: CopilotType;
  readonly subQuery: string;
}

/**
 * Distribui uma consulta composta entre copilotos: cada segmento (separado por
 * ';' ou 'e também') é roteado ao copiloto mais aderente.
 */
export function distributeTasks(query: string): CopilotTask[] {
  const segments = query.split(/;|\be também\b/i).map(s => s.trim()).filter(Boolean);
  const source = segments.length > 0 ? segments : [query];
  return source.map(subQuery => ({
    copilotType: selectCopilot(subQuery).copilotType,
    subQuery,
  }));
}
