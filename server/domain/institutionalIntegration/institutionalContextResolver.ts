/**
 * RC-5.0 — Institutional Knowledge Integration Layer · InstitutionalContextResolver (Componente 1).
 *
 * Resolve DETERMINISTICAMENTE o contexto institucional (Federal → Estado → Município → Documentos)
 * para uma execução cognitiva, consultando EXCLUSIVAMENTE o Official Knowledge Corpus (RC-4.9).
 * Isolamento multi-tenant absoluto. SEM IA, SEM interpretação, SEM chamadas ao LLM.
 */

import type { OfficialCorpusRegistry } from "../officialCorpus/officialCorpusRegistry";
import { resolveContext } from "../officialCorpus/officialCorpusRegistry";
import type { OfficialDocument, Esfera } from "../officialCorpus/officialDocument";

export interface UserContext {
  readonly state?: string | null;
  readonly municipality?: string | null;
}

export interface InstitutionalContextInput {
  readonly tenantId: number;
  readonly businessDomain?: string | null;
  readonly taskType: string;
  readonly userContext?: UserContext;
}

export interface InstitutionalContext {
  readonly tenantId: number;
  readonly state: string | null;
  readonly municipality: string | null;
  readonly businessDomain: string | null;
  readonly taskType: string;
  /** Documentos aplicáveis, ordenados Federal → Estadual → Municipal (federal precede). */
  readonly applicableDocuments: readonly OfficialDocument[];
  readonly hierarchy: readonly Esfera[];
}

/**
 * Infere estado/município do tenant a partir de seus documentos municipais no corpus
 * (determinístico), com prioridade para o userContext quando informado.
 */
function inferTenantLocation(registry: OfficialCorpusRegistry, tenantId: number, userContext?: UserContext): { state: string | null; municipality: string | null } {
  const municipalDocs = registry.documents
    .filter(d => d.jurisdiction === "municipal" && d.tenantId === tenantId)
    .sort((a, b) => a.documentId.localeCompare(b.documentId));
  const fromDocs = municipalDocs[0];
  return {
    state: userContext?.state ?? fromDocs?.state ?? null,
    municipality: userContext?.municipality ?? fromDocs?.municipality ?? null,
  };
}

/**
 * Resolve o contexto institucional. Reusa a resolução hierárquica da RC-4.9 (federal precede;
 * estadual/municipal complementam) com isolamento multi-tenant: um tenant jamais recebe documentos
 * municipais de outro tenant. Determinístico.
 */
export function resolveInstitutionalContext(registry: OfficialCorpusRegistry, input: InstitutionalContextInput): InstitutionalContext {
  const loc = inferTenantLocation(registry, input.tenantId, input.userContext);
  const resolved = resolveContext(registry, { state: loc.state, municipality: loc.municipality, tenantId: input.tenantId });
  return {
    tenantId: input.tenantId,
    state: loc.state,
    municipality: loc.municipality,
    businessDomain: input.businessDomain ?? null,
    taskType: input.taskType,
    applicableDocuments: resolved.documents,
    hierarchy: resolved.order,
  };
}
