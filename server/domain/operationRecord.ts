/**
 * FASE 5 — Business Domain 5: Centro de Operações do Departamento de Licitações
 *
 * OperationRecord registra manualmente itens que NÃO nasceram no LiciGov — processos
 * e instrumentos legados ou externos, reuniões, eventos e tarefas. Permite cadastrar
 * um processo completo OU apenas partes (só um contrato, só um aditivo, só uma
 * reunião…) — nunca obriga reconstrução completa. Determinístico, multi-tenant.
 *
 * Este módulo NÃO cria licitações/contratos/pareceres — apenas acompanha, organiza,
 * consolida e recomenda. Nunca duplica dados dos Business Domains.
 */

import { createHash } from "crypto";

export type OperationRecordType =
  | "processo_licitatorio_legado"
  | "contratacao_direta_legada"
  | "contrato_externo"
  | "aditivo_externo"
  | "ata_externa"
  | "parecer_externo"
  | "reuniao"
  | "evento"
  | "tarefa"
  | "outro";

export type OperationOrigin = "interna" | "externa";

export const OPERATION_RECORD_TYPES: readonly OperationRecordType[] = [
  "processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo",
  "aditivo_externo", "ata_externa", "parecer_externo", "reuniao", "evento", "tarefa", "outro",
];

export interface OperationRecord {
  readonly id: string;
  readonly organizationId: number;
  readonly recordType: OperationRecordType;
  readonly origin: OperationOrigin;
  readonly number: string;
  readonly object: string;
  readonly modality: string;
  readonly currentStage: string;
  readonly responsible: number | null;
  /** Referência a um workspace de domínio, quando o registro apenas complementa. */
  readonly referenceType: string;
  readonly referenceId: string;
  readonly documentReferences: readonly string[];
  readonly notes: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createOperationRecord(params: {
  organizationId: number;
  recordType: OperationRecordType;
  origin?: OperationOrigin;
  number?: string;
  object?: string;
  modality?: string;
  currentStage?: string;
  responsible?: number | null;
  referenceType?: string;
  referenceId?: string;
  documentReferences?: string[];
  notes?: string;
  correlationId: string;
  createdAt?: string;
}): OperationRecord {
  const id = createHash("sha256")
    .update(`oprec:${params.organizationId}:${params.recordType}:${params.number ?? ""}:${params.correlationId}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    recordType: params.recordType,
    origin: params.origin ?? "externa",
    number: params.number ?? "",
    object: params.object ?? "",
    modality: params.modality ?? "",
    currentStage: params.currentStage ?? "",
    responsible: params.responsible ?? null,
    referenceType: params.referenceType ?? "",
    referenceId: params.referenceId ?? "",
    documentReferences: params.documentReferences ?? [],
    notes: params.notes ?? "",
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

// ─── Importação Assistida (legado externo) ────────────────────────────────────

/** Aviso institucional da importação assistida (depende da confirmação do servidor). */
export const LEGACY_IMPORT_DISCLAIMER =
  "Registro importado de forma assistida a partir do documento enviado. Os campos " +
  "identificados são uma sugestão e dependem da confirmação do servidor. Origem: Externa.";

export interface LegacyExtractedFields {
  readonly number: string;
  readonly object: string;
  readonly modality: string;
}

function matchAfter(text: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*(.+)`, "i");
    const m = text.match(re);
    if (m && m[1]) return m[1].trim().split(/\n/)[0].trim();
  }
  return "";
}

/** Extração determinística (assistida) dos campos de um processo/contrato legado. */
export function reconstructLegacyRecord(text: string): LegacyExtractedFields {
  return {
    number: matchAfter(text, ["processo n[ºo°]", "contrato n[ºo°]", "número", "n[ºo°]"]),
    object: matchAfter(text, ["objeto", "do objeto"]),
    modality: matchAfter(text, ["modalidade", "dispensa", "inexigibilidade", "preg[ãa]o"]),
  };
}

export function createLegacyImportRecord(params: {
  organizationId: number;
  recordType: OperationRecordType;
  rawText: string;
  correlationId: string;
  createdAt?: string;
}): { record: OperationRecord; disclaimer: string; confidence: number } {
  const fields = reconstructLegacyRecord(params.rawText);
  const filled = [fields.number, fields.object, fields.modality].filter(f => f.length > 0).length;
  const confidence = Math.round((filled / 3) * 100) / 100;
  const record = createOperationRecord({
    organizationId: params.organizationId, recordType: params.recordType, origin: "externa",
    number: fields.number, object: fields.object, modality: fields.modality, currentStage: "registrado",
    correlationId: params.correlationId, createdAt: params.createdAt,
  });
  return { record, disclaimer: LEGACY_IMPORT_DISCLAIMER, confidence };
}
