import { createHash } from "crypto";

export type ConceptCategory =
  | "modalidade"
  | "criterio_julgamento"
  | "regime_contratacao"
  | "tipo_documento"
  | "tipo_risco"
  | "tipo_objeto"
  | "fase_licitacao"
  | "qualificacao"
  | "recurso"
  | "sancao";

export interface ProcurementConcept {
  readonly id: string;
  readonly organizationId: number;
  readonly category: ConceptCategory;
  readonly name: string;
  readonly normalizedName: string;
  readonly definition: string;
  readonly legalBasis: string;
  readonly parentConceptId: string | null;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly createdAt: string;
}

export function createProcurementConcept(params: {
  organizationId: number;
  category: ConceptCategory;
  name: string;
  definition: string;
  legalBasis?: string;
  parentConceptId?: string | null;
  aliases?: string[];
  examples?: string[];
}): ProcurementConcept {
  const normalizedName = params.name.toLowerCase().trim().replace(/\s+/g, " ");
  const id = createHash("sha256")
    .update(`pc:${params.organizationId}:${params.category}:${normalizedName}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    category: params.category,
    name: params.name,
    normalizedName,
    definition: params.definition,
    legalBasis: params.legalBasis ?? "",
    parentConceptId: params.parentConceptId ?? null,
    aliases: params.aliases ?? [],
    examples: params.examples ?? [],
    createdAt: new Date().toISOString(),
  };
}

export function matchesConcept(concept: ProcurementConcept, query: string): boolean {
  const normalized = query.toLowerCase().trim();
  if (concept.normalizedName.includes(normalized)) return true;
  return concept.aliases.some(a => a.toLowerCase().includes(normalized));
}

export function isChildOf(child: ProcurementConcept, parentId: string): boolean {
  return child.parentConceptId === parentId;
}
