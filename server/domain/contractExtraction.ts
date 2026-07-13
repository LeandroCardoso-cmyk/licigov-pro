/**
 * FASE 5 — Contratos: Importação de Contrato Externo (FLUXO 3, obrigatório)
 *
 * Nenhuma prefeitura começa apenas com contratos novos. Este módulo importa um
 * contrato externo (PDF/DOCX convertido em texto), EXTRAI campos por heurística
 * determinística e RECONSTRÓI a estrutura para criar o Workspace.
 *
 * A extração real de binário/OCR é Future Evolution — aqui trabalhamos sobre o
 * texto fornecido, de forma determinística e replay-safe.
 */

import { createHash } from "crypto";

export type ImportedContractSource = "pdf" | "docx";

export interface ExtractedContractFields {
  readonly contractNumber: string;
  readonly contractor: string;
  readonly object: string;
  readonly value: number;
  readonly term: string;
  readonly clauses: readonly string[];
}

export interface ImportedContract {
  readonly id: string;
  readonly organizationId: number;
  readonly source: ImportedContractSource;
  readonly rawTextHash: string;
  readonly extracted: ExtractedContractFields;
  readonly confidence: number;
  readonly correlationId: string;
  readonly createdAt: string;
}

const MONEY_RE = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d+(?:\.\d+)?)/;

function parseMoney(raw: string): number {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function matchAfter(text: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*(.+)`, "i");
    const m = text.match(re);
    if (m && m[1]) return m[1].trim().split(/\n/)[0].trim();
  }
  return "";
}

/** Extrai campos do texto do contrato de forma determinística (heurística). */
export function extractContractFields(text: string): ExtractedContractFields {
  const contractNumber = matchAfter(text, ["contrato n[ºo°]", "número do contrato", "contrato administrativo n[ºo°]"]);
  const contractor = matchAfter(text, ["contratad[oa]", "empresa contratada", "fornecedor"]);
  const object = matchAfter(text, ["objeto", "do objeto"]);
  const term = matchAfter(text, ["vig[êe]ncia", "prazo de vig[êe]ncia", "prazo"]);
  const valueLine = matchAfter(text, ["valor global", "valor total", "valor do contrato", "valor"]);
  const valueMatch = valueLine.match(MONEY_RE);
  const value = valueMatch ? parseMoney(valueMatch[1]) : 0;

  // Cláusulas: linhas iniciadas por "CLÁUSULA" (reconstrução de estrutura).
  const clauses = text.split(/\n/).map(l => l.trim())
    .filter(l => /^cl[áa]usula/i.test(l))
    .slice(0, 50);

  return { contractNumber, contractor, object, value, term, clauses };
}

/** Confiança determinística da extração (proporção de campos preenchidos). */
export function extractionConfidence(fields: ExtractedContractFields): number {
  const checks = [
    fields.contractNumber.length > 0,
    fields.contractor.length > 0,
    fields.object.length > 0,
    fields.value > 0,
    fields.term.length > 0,
  ];
  const hit = checks.filter(Boolean).length;
  return Math.round((hit / checks.length) * 100) / 100;
}

export function createImportedContract(params: {
  organizationId: number;
  source: ImportedContractSource;
  rawText: string;
  correlationId: string;
  createdAt?: string;
}): ImportedContract {
  const rawTextHash = createHash("sha256").update(params.rawText).digest("hex").slice(0, 32);
  const extracted = extractContractFields(params.rawText);
  const id = createHash("sha256")
    .update(`imp:${params.organizationId}:${rawTextHash}`)
    .digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, source: params.source, rawTextHash, extracted,
    confidence: extractionConfidence(extracted), correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}
