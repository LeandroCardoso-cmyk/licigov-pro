/**
 * RC-4.9 — Official Knowledge Corpus · Registro, Consultas (Fase 8) e Resolução hierárquica (Fase 6).
 *
 * Registra corpora oficiais (via Institutional Corpus Framework) e documentos classificados;
 * oferece consultas declarativas e a resolução Federal → Estado → Município (municipal complementa,
 * nunca substitui o federal). Determinístico, multi-tenant. Sem IA/RAG/chat.
 */

import { createInstitutionalCorpus, type InstitutionalCorpus } from "../corpus/institutionalCorpus";
import { type OfficialDocument, type OfficialDocumentType, type Esfera, ESFERA_PRIORITY } from "./officialDocument";

export interface OfficialCorpusRegistry {
  readonly corpora: readonly InstitutionalCorpus[];
  readonly documents: readonly OfficialDocument[];
}

export function createOfficialCorpusRegistry(corpora: InstitutionalCorpus[] = [], documents: OfficialDocument[] = []): OfficialCorpusRegistry {
  return {
    corpora: [...corpora].sort((a, b) => a.id.localeCompare(b.id)),
    documents: [...documents].sort((a, b) => a.documentId.localeCompare(b.documentId)),
  };
}

/** Corpora oficiais: Federal (raiz) → Paraná (estadual) → Moreira Sales (municipal). Hierarquia real. */
export function buildOfficialCorpora(municipalTenantId: number): InstitutionalCorpus[] {
  const T = "2026-01-01T00:00:00.000Z";
  const federal = createInstitutionalCorpus({ tenantId: 0, name: "Corpus Federal", type: "federal", scope: "uniao", jurisdiction: "federal", owner: "Governo Federal", status: "active", createdAt: T, updatedAt: T });
  const parana = createInstitutionalCorpus({ tenantId: 0, name: "Corpus Estadual — Paraná", type: "estadual", scope: "estado", jurisdiction: "estadual", owner: "Estado do Paraná", parentId: federal.id, status: "active", createdAt: T, updatedAt: T, metadata: { state: "PR" } });
  const moreiraSales = createInstitutionalCorpus({ tenantId: municipalTenantId, name: "Corpus Municipal — Moreira Sales", type: "municipal", scope: "municipio", jurisdiction: "municipal", owner: "Município de Moreira Sales", parentId: parana.id, status: "active", createdAt: T, updatedAt: T, metadata: { state: "PR", municipality: "Moreira Sales" } });
  return [federal, parana, moreiraSales];
}

export function addOfficialDocument(registry: OfficialCorpusRegistry, doc: OfficialDocument): OfficialCorpusRegistry {
  if (registry.documents.some(d => d.documentId === doc.documentId)) return registry;
  return createOfficialCorpusRegistry([...registry.corpora], [...registry.documents, doc]);
}

// ── Consultas (Fase 8) ────────────────────────────────────────────────────────

export function findByEsfera(registry: OfficialCorpusRegistry, esfera: Esfera): OfficialDocument[] {
  return registry.documents.filter(d => d.jurisdiction === esfera).sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findByAuthority(registry: OfficialCorpusRegistry, authority: string): OfficialDocument[] {
  return registry.documents.filter(d => d.authority === authority).sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findByState(registry: OfficialCorpusRegistry, state: string): OfficialDocument[] {
  return registry.documents.filter(d => d.state === state).sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findByMunicipality(registry: OfficialCorpusRegistry, municipality: string): OfficialDocument[] {
  return registry.documents.filter(d => d.municipality === municipality).sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findByType(registry: OfficialCorpusRegistry, type: OfficialDocumentType): OfficialDocument[] {
  return registry.documents.filter(d => d.documentType === type).sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findVigentes(registry: OfficialCorpusRegistry): OfficialDocument[] {
  return registry.documents.filter(d => d.status === "vigente").sort((a, b) => a.documentId.localeCompare(b.documentId));
}
export function findByTenant(registry: OfficialCorpusRegistry, tenantId: number): OfficialDocument[] {
  return registry.documents.filter(d => d.tenantId === tenantId).sort((a, b) => a.documentId.localeCompare(b.documentId));
}

// ── Resolução hierárquica (Fase 6) ────────────────────────────────────────────

export interface ResolutionQuery {
  readonly state?: string | null;
  readonly municipality?: string | null;
  readonly tenantId?: number | null;
}

export interface ResolvedContext {
  /** Documentos aplicáveis, ordenados Federal → Estadual → Municipal (federal sempre primeiro). */
  readonly documents: readonly OfficialDocument[];
  readonly order: readonly Esfera[];
  readonly explanation: string;
}

/**
 * Resolve o contexto normativo respeitando a prioridade Federal → Estado → Município. Documentos
 * municipais COMPLEMENTAM (nunca substituem) as normas federais/estaduais. Determinístico.
 */
export function resolveContext(registry: OfficialCorpusRegistry, query: ResolutionQuery): ResolvedContext {
  const applicable = registry.documents.filter(d => {
    if (d.jurisdiction === "federal") return true;
    if (d.jurisdiction === "estadual") return !query.state || d.state === query.state;
    // municipal
    if (query.tenantId != null && d.tenantId === query.tenantId) return true;
    if (query.municipality && d.municipality === query.municipality) return true;
    return false;
  }).sort((a, b) =>
    ESFERA_PRIORITY[a.jurisdiction] - ESFERA_PRIORITY[b.jurisdiction]
    || a.documentId.localeCompare(b.documentId));

  return {
    documents: applicable,
    order: ["federal", "estadual", "municipal"],
    explanation: "Resolução hierárquica: normas federais têm precedência; estaduais e municipais complementam, nunca substituem o federal.",
  };
}
