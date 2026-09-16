export const GOVERNED_LAW_CORPUS_VERSION = "f-rag1-v1";
export const GOVERNED_LAW_CONTENT_KIND = "governed_reference_summary";

export interface GovernedChunkMetadata {
  readonly governedMaterialization: true;
  readonly materializationKey: string;
  readonly materializerVersion: string;
  readonly contentKind: typeof GOVERNED_LAW_CONTENT_KIND;
  readonly generatedFrom: "legal_reference_entries.hypothesisSummary";
  readonly summaryNotVerbatimStatutoryText: true;
  readonly referenceSetId: number;
  readonly referenceSetVersion: number;
  readonly referenceSetContentHash: string;
  readonly referenceEntryId: number;
  readonly sourceContentHash: string;
  readonly canonicalLocator: string;
  readonly canonicalDisplay: string;
  readonly sourceAuthority: string;
  readonly sourceIdentifier: string;
  readonly sourceUrl: string;
  readonly publicationDate: string | null;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly activeReference: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Boundary puro de leitura da provenance do corpus governado.
 * Retorna null para metadata legada/desconhecida; nunca "adivinha" lineage.
 */
export function readGovernedChunkMetadata(value: unknown): GovernedChunkMetadata | null {
  const record = asRecord(value);
  if (!record || record.governedMaterialization !== true) return null;
  if (record.contentKind !== GOVERNED_LAW_CONTENT_KIND) return null;
  if (typeof record.materializationKey !== "string") return null;
  if (typeof record.referenceSetContentHash !== "string") return null;
  if (typeof record.activeReference !== "boolean") return null;
  return record as unknown as GovernedChunkMetadata;
}
