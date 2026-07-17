/**
 * RC-4.9 — Official Knowledge Corpus · Explainability.
 *
 * Todo documento oficial se EXPLICA: origem/fonte, esfera, autoridade, hierarquia, vigência,
 * pipeline aplicado, publicação e lineage. Nunca informação implícita. Determinístico.
 */

import type { IngestedDocument } from "./officialCorpusIngestion";

export interface OfficialDocumentExplanation {
  readonly documentId: string;
  readonly origin: { readonly source: string; readonly authority: string; readonly title: string };
  readonly classification: { readonly type: string; readonly jurisdiction: string; readonly scope: string; readonly state: string | null; readonly municipality: string | null; readonly tenantId: number | null };
  readonly validity: { readonly status: string; readonly effectiveDate: string | null; readonly version: string };
  readonly pipeline: { readonly executionStatus: string; readonly executedStages: number; readonly gatesPassed: boolean };
  readonly publication: { readonly published: boolean; readonly semver: string | null; readonly checksum: string | null };
  readonly knowledgeDocumentId: string | null;
  readonly structuralNodes: number;
  readonly summary: string;
}

/** Explica um documento incorporado, cobrindo classificação, vigência, pipeline e publicação. */
export function explainOfficialDocument(ingested: IngestedDocument): OfficialDocumentExplanation {
  const o = ingested.official;
  return {
    documentId: o.documentId,
    origin: { source: o.source, authority: o.authority, title: o.title },
    classification: { type: o.documentType, jurisdiction: o.jurisdiction, scope: o.scope, state: o.state, municipality: o.municipality, tenantId: o.tenantId },
    validity: { status: o.status, effectiveDate: o.effectiveDate, version: o.version },
    pipeline: { executionStatus: ingested.execution.execution.status, executedStages: ingested.execution.execution.executedStages.length, gatesPassed: ingested.publication.gates.passed },
    publication: { published: ingested.publication.published, semver: ingested.publication.snapshot?.version.semver ?? null, checksum: ingested.publication.snapshot?.manifest.checksum ?? null },
    knowledgeDocumentId: o.knowledgeDocumentId,
    structuralNodes: ingested.normativeTree?.nodes.length ?? 0,
    summary: `${o.title} — ${o.documentType} (${o.jurisdiction}), autoridade ${o.authority}, ${o.status}, publicado=${ingested.publication.published}, ${ingested.normativeTree?.nodes.length ?? 0} nós estruturais.`,
  };
}
