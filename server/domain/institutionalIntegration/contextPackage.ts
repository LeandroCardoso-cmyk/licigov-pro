/**
 * RC-5.0 — Institutional Knowledge Integration Layer · ContextPackage (Componente 3).
 *
 * Estrutura ÚNICA e IMUTÁVEL de contexto institucional para consumo pelo AIExecutionEngine.
 * Replay-safe, versionada, auditável, determinística. Módulo PURO — NÃO importa o Official Corpus
 * (é o contrato de dados que o engine importa como tipo). Sem IA/sumarização/interpretação.
 */

import { createHash } from "crypto";

export const CONTEXT_PACKAGE_CONTRACT = "institutional-context/1.0";

export interface ContextDocument {
  readonly documentId: string;
  readonly normId: string;
  readonly title: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly version: string;
  readonly bindingLevel: string;
  readonly status: string;
}

export interface RetrievedPassage {
  readonly documentId: string;
  readonly normId: string;
  readonly blockId: string;
  /** Identificador estrutural do trecho (ex.: "Art. 1º", "Trecho 3"). */
  readonly identifier: string;
  readonly text: string;
  /** Pontuação determinística de relevância (0..1). */
  readonly score: number;
}

export interface Citation {
  readonly documentId: string;
  /** Referência citável (ex.: "Lei nº 14.133/2021 — Art. 1º"). */
  readonly reference: string;
  readonly authority: string;
  readonly version: string;
  readonly jurisdiction: string;
  readonly bindingLevel: string;
  readonly lineageId: string;
}

export interface ContextExplainabilityEntry {
  readonly documentId: string;
  readonly reason: string;
  readonly authority: string;
  readonly version: string;
  readonly bindingLevel: string;
  readonly lineageId: string;
}

export interface ContextPackage {
  readonly contextId: string;
  readonly contract: string;
  readonly correlationId: string;
  readonly replayId: string;
  readonly tenantId: number | null;
  readonly municipality: string | null;
  readonly state: string | null;
  readonly businessDomain: string | null;
  readonly taskType: string;
  /** Ordem hierárquica de esferas aplicada (federal → estadual → municipal). */
  readonly hierarchy: readonly string[];
  readonly documents: readonly ContextDocument[];
  readonly retrievedPassages: readonly RetrievedPassage[];
  readonly citations: readonly Citation[];
  readonly bindingLevels: readonly string[];
  readonly explainability: readonly ContextExplainabilityEntry[];
  readonly metadata: Record<string, unknown>;
  /** Hash determinístico do pacote (replay-safe; sem tempo). */
  readonly replayHash: string;
}

export interface CreateContextPackageParams {
  correlationId: string;
  tenantId: number | null;
  municipality?: string | null;
  state?: string | null;
  businessDomain?: string | null;
  taskType: string;
  hierarchy: string[];
  documents: ContextDocument[];
  retrievedPassages: RetrievedPassage[];
  citations: Citation[];
  explainability: ContextExplainabilityEntry[];
  metadata?: Record<string, unknown>;
}

function computeReplayHash(p: Omit<ContextPackage, "contextId" | "replayId" | "replayHash">): string {
  return createHash("sha256").update(JSON.stringify({
    tenant: p.tenantId, municipality: p.municipality, state: p.state, domain: p.businessDomain, task: p.taskType,
    hierarchy: p.hierarchy, documents: p.documents.map(d => `${d.documentId}@${d.version}`),
    passages: p.retrievedPassages.map(pp => `${pp.blockId}:${pp.score}`),
    citations: p.citations.map(c => c.reference), bindings: [...p.bindingLevels].sort(), metadata: p.metadata,
  })).digest("hex").slice(0, 32);
}

/** Cria um ContextPackage IMUTÁVEL (congelado) e determinístico. */
export function createContextPackage(params: CreateContextPackageParams): ContextPackage {
  const bindingLevels = [...new Set(params.documents.map(d => d.bindingLevel))].sort();
  const base: Omit<ContextPackage, "contextId" | "replayId" | "replayHash"> = {
    contract: CONTEXT_PACKAGE_CONTRACT, correlationId: params.correlationId, tenantId: params.tenantId,
    municipality: params.municipality ?? null, state: params.state ?? null,
    businessDomain: params.businessDomain ?? null, taskType: params.taskType, hierarchy: Object.freeze([...params.hierarchy]),
    documents: Object.freeze([...params.documents]), retrievedPassages: Object.freeze([...params.retrievedPassages]),
    citations: Object.freeze([...params.citations]), bindingLevels: Object.freeze(bindingLevels),
    explainability: Object.freeze([...params.explainability]), metadata: Object.freeze({ ...(params.metadata ?? {}) }),
  };
  const replayHash = computeReplayHash(base);
  const contextId = createHash("sha256").update(`ctxpkg:${params.tenantId ?? "-"}:${params.taskType}:${replayHash}`).digest("hex").slice(0, 20);
  const replayId = createHash("sha256").update(`replay:${params.correlationId}:${replayHash}`).digest("hex").slice(0, 20);
  return Object.freeze({ contextId, replayId, ...base, replayHash });
}
