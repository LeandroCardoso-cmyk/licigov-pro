/**
 * Manifesto da reconciliação de schema — divergências apontadas pela auditoria
 * (scripts/schema-audit.ts) entre o Drizzle e o banco de produção (criado por
 * db:push antigo, com o journal marcando as migrations como aplicadas).
 *
 * Fonte da verdade para:
 *  - drizzle/0285_schema_reconciliation.sql  → cria as TABELAS ausentes (IF NOT EXISTS)
 *  - server/bootstrap.ts (ensureSchema)      → adiciona as COLUNAS ausentes (addColumnIfMissing)
 *  - os testes de paridade e o smoke MySQL da reconciliação
 *
 * Se uma nova rodada da auditoria apontar outras divergências, atualize AQUI e
 * os testes garantem que migration/bootstrap acompanhem.
 */

/** Tabelas presentes no schema.ts e ausentes no banco de produção (17). */
export const MISSING_TABLES: readonly string[] = [
  "document_attachments",
  "document_drafts",
  "document_render_cache",
  "document_timeline",
  "document_versions",
  "feature_flags",
  "idempotency_keys",
  "organization_members",
  "organizations",
  "outbox_dead_letters",
  "outbox_events",
  "parser_capabilities",
  "retrieval_evidences_v2",
  "retrieval_sessions_v2",
  "semantic_chunks_v2",
  "stage_assignments",
  "tenant_feature_flags",
];

/** Colunas presentes no schema.ts e ausentes em tabelas que EXISTEM no banco (54). */
export const MISSING_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  clause_knowledge: ["purpose", "related_document_types", "prerequisites", "active", "correlation_id"],
  context_assemblies: [
    "query_id", "retrieved_chunks", "legal_references", "municipality_history", "similar_trs",
    "semantic_evidence", "prompt_context", "total_tokens", "assembly_strategy", "correlation_id",
  ],
  entity_resolutions: ["confidence", "correlation_id"],
  extraction_evidence: ["provenanceSheet", "provenancePage", "provenanceRow", "provenanceCol"],
  graph_change_log: ["changed_by", "correlation_id", "created_at"],
  graph_metrics: ["metric_unit", "created_at"],
  graph_versions: ["change_summary", "correlation_id"],
  legal_reference_nodes: [
    "numero", "ano", "orgao", "artigo", "alinea", "texto", "vigencia", "ementa", "correlation_id",
  ],
  ontology_taxonomy: ["category", "definition", "legal_basis", "aliases", "correlation_id"],
  process_members: ["functionalRole"],
  procurement_concepts: ["parent_concept_id", "examples", "correlation_id"],
  semantic_candidates: ["explanationPenalty", "explanationBonus", "catmatDesc", "catmatGroup"],
  semantic_search_entries: ["subcategory", "lastSeenAt", "catmatGroup", "catmatClass"],
};

/** Total de colunas do manifesto (espera-se 54). */
export const MISSING_COLUMNS_TOTAL = Object.values(MISSING_COLUMNS).reduce(
  (sum, cols) => sum + cols.length,
  0
);
