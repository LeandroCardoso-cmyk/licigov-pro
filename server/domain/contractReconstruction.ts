/**
 * SPRINT 5.3.1 — Contratos: RECONSTRUÇÃO ASSISTIDA do Contrato (FLUXO externo)
 *
 * Nenhuma prefeitura começa apenas com contratos novos. Este módulo faz a
 * RECONSTRUÇÃO ASSISTIDA de um contrato externo (PDF/DOCX convertido em texto):
 * identifica fornecedor, objeto, prazo, valor e cláusulas e APRESENTA ao servidor
 * para revisão. O sistema NUNCA transmite a ideia de reconstrução perfeita — a
 * reconstrução é ASSISTIDA e depende sempre da VALIDAÇÃO do servidor.
 *
 * Fluxo: PDF/DOCX → Reconstrução Assistida → Identificação → Apresentação ao
 * servidor → Servidor revisa → Criação do Workspace. Determinístico, replay-safe.
 */

import { createHash } from "crypto";

export type ImportedContractSource = "pdf" | "docx";

/** Aviso institucional exibido sempre que houver reconstrução assistida. */
export const RECONSTRUCTION_DISCLAIMER =
  "Contrato reconstruído de forma assistida a partir do documento enviado. " +
  "A identificação dos campos é uma sugestão e depende da validação do servidor.";

export interface ReconstructedContractFields {
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
  readonly reconstructed: ReconstructedContractFields;
  readonly confidence: number;
  /** A reconstrução é sempre ASSISTIDA (nunca automática/perfeita). */
  readonly assisted: true;
  /** Só passa a valer após a revisão do servidor. */
  readonly reviewedByServer: boolean;
  readonly disclaimer: string;
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

/**
 * Reconstrói (de forma assistida) os campos do contrato a partir do texto. É uma
 * SUGESTÃO determinística — o servidor sempre revisa antes de criar o Workspace.
 */
export function reconstructContractFields(text: string): ReconstructedContractFields {
  const contractNumber = matchAfter(text, ["contrato n[ºo°]", "número do contrato", "contrato administrativo n[ºo°]"]);
  const contractor = matchAfter(text, ["contratad[oa]", "empresa contratada", "fornecedor"]);
  const object = matchAfter(text, ["objeto", "do objeto"]);
  const term = matchAfter(text, ["vig[êe]ncia", "prazo de vig[êe]ncia", "prazo"]);
  const valueLine = matchAfter(text, ["valor global", "valor total", "valor do contrato", "valor"]);
  const valueMatch = valueLine.match(MONEY_RE);
  const value = valueMatch ? parseMoney(valueMatch[1]) : 0;

  const clauses = text.split(/\n/).map(l => l.trim())
    .filter(l => /^cl[áa]usula/i.test(l))
    .slice(0, 50);

  return { contractNumber, contractor, object, value, term, clauses };
}

/** Confiança determinística da reconstrução assistida (campos identificados). */
export function reconstructionConfidence(fields: ReconstructedContractFields): number {
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

/**
 * Cria o registro da RECONSTRUÇÃO ASSISTIDA, ainda pendente de revisão do servidor.
 */
export function createAssistedReconstruction(params: {
  organizationId: number;
  source: ImportedContractSource;
  rawText: string;
  correlationId: string;
  createdAt?: string;
}): ImportedContract {
  const rawTextHash = createHash("sha256").update(params.rawText).digest("hex").slice(0, 32);
  const reconstructed = reconstructContractFields(params.rawText);
  const id = createHash("sha256")
    .update(`imp:${params.organizationId}:${rawTextHash}`)
    .digest("hex").slice(0, 20);
  return {
    id, organizationId: params.organizationId, source: params.source, rawTextHash, reconstructed,
    confidence: reconstructionConfidence(reconstructed), assisted: true, reviewedByServer: false,
    disclaimer: RECONSTRUCTION_DISCLAIMER, correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}
