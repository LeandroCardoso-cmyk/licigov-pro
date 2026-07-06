/**
 * Sprint 5.1 — DFD como ESTADO do processo (não apenas documento)
 *
 * O DFD (Documento de Formalização da Demanda) é tratado como um estado com
 * ciclo próprio. Pode ser inexistente, importado, elaborado, revisado e aprovado.
 * Quando presente, alimenta automaticamente campos do ETP. Determinístico.
 */

import { createHash } from "crypto";

export type DFDStatus =
  | "inexistente"
  | "importado"
  | "em_elaboracao"
  | "em_revisao"
  | "aprovado";

export type DFDSource = "nenhum" | "manual" | "pdf" | "docx" | "oficio" | "memorando";

export interface DFDState {
  readonly id: string;
  readonly processId: string;
  readonly organizationId: number;
  readonly status: DFDStatus;
  readonly source: DFDSource;
  /** Campos estruturados extraídos/preenchidos, reaproveitáveis no ETP. */
  readonly extractedFields: Record<string, string>;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const DFD_TRANSITIONS: Record<DFDStatus, DFDStatus[]> = {
  inexistente: ["importado", "em_elaboracao"],
  importado: ["em_revisao", "em_elaboracao", "aprovado"],
  em_elaboracao: ["em_revisao"],
  em_revisao: ["em_elaboracao", "aprovado"],
  aprovado: [],
};

export function createDFDState(params: {
  processId: string;
  organizationId: number;
  status?: DFDStatus;
  source?: DFDSource;
  extractedFields?: Record<string, string>;
  correlationId: string;
  createdAt?: string;
}): DFDState {
  const id = createHash("sha256")
    .update(`dfd:${params.organizationId}:${params.processId}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    processId: params.processId,
    organizationId: params.organizationId,
    status: params.status ?? "inexistente",
    source: params.source ?? "nenhum",
    extractedFields: params.extractedFields ?? {},
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function canTransitionDFD(from: DFDStatus, to: DFDStatus): boolean {
  return DFD_TRANSITIONS[from].includes(to);
}

export function transitionDFD(dfd: DFDState, to: DFDStatus, at?: string): DFDState {
  if (!canTransitionDFD(dfd.status, to)) {
    throw new Error(`Transição de DFD inválida: ${dfd.status} → ${to}`);
  }
  return { ...dfd, status: to, updatedAt: at ?? new Date().toISOString() };
}

/** Registra o resultado de uma importação (PDF/DOCX/ofício/memorando). */
export function importDFD(dfd: DFDState, source: DFDSource, fields: Record<string, string>, at?: string): DFDState {
  return {
    ...dfd,
    status: "importado",
    source,
    extractedFields: { ...dfd.extractedFields, ...fields },
    updatedAt: at ?? new Date().toISOString(),
  };
}

export function isDFDReady(dfd: DFDState): boolean {
  return dfd.status === "aprovado";
}
