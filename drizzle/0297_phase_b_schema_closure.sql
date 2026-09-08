-- 0297 — Phase B: schema closure (V1 PRE-PILOT CLOSURE — RUNTIME & RELEASE SAFETY).
--
-- Fecha, como MIGRATION VERSIONADA, o schema que ate aqui so era reconciliado em runtime pelo
-- ensureSchema() (server/bootstrap.ts). A diferenca foi computada empiricamente: schema de um banco
-- apos migrate() apenas  vs  apos migrate()+ensureSchema(). Duas classes de operacao:
--   * RENAME snake_case -> camelCase (colunas criadas por migrations antigas em snake; schema.ts usa camel);
--   * ADD COLUMN de colunas que so o reconciliador adicionava (definicoes identicas as do ensureSchema,
--     ja provadas em producao).
--
-- IDEMPOTENTE e PRECONDITION-SAFE: e uma migration NOVA (idx 297), entao roda uma vez em cada banco —
-- inclusive na PRODUCAO ja convergida pelo antigo ensureSchema. Por isso cada operacao e guardada por
-- INFORMATION_SCHEMA (nao usa ADD/RENAME ... IF [NOT] EXISTS, ausente no MySQL 8):
--   ADD    -> so adiciona se a tabela existe e a coluna falta (senao no-op).
--   RENAME -> matriz de precondicao (secao 3 do plano):
--             from existe / to ausente  -> renomeia (RENAME COLUMN preserva dados, tipo e indices);
--             from ausente / to existe   -> ja convergido -> no-op seguro;
--             from + to existem          -> AMBIGUO -> falha explicita (SIGNAL), nunca escolhe silenciosamente;
--             nenhum existe              -> falha explicita (SIGNAL).
-- Puramente aditiva/renomeadora: NAO faz DROP nem perde dados.
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_pb_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_pb_rename_col
--> statement-breakpoint
CREATE PROCEDURE licigov_pb_add_col(IN p_tbl VARCHAR(64), IN p_col VARCHAR(64), IN p_def TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_col) = 0 THEN
    SET @licigov_pb_ddl = CONCAT('ALTER TABLE `', p_tbl, '` ADD COLUMN `', p_col, '` ', p_def);
    PREPARE licigov_pb_stmt FROM @licigov_pb_ddl;
    EXECUTE licigov_pb_stmt;
    DEALLOCATE PREPARE licigov_pb_stmt;
  END IF;
END
--> statement-breakpoint
CREATE PROCEDURE licigov_pb_rename_col(IN p_tbl VARCHAR(64), IN p_from VARCHAR(64), IN p_to VARCHAR(64))
BEGIN
  DECLARE v_tbl INT DEFAULT 0;
  DECLARE v_from INT DEFAULT 0;
  DECLARE v_to INT DEFAULT 0;
  SELECT COUNT(*) INTO v_tbl FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl;
  IF v_tbl = 1 THEN
    SELECT COUNT(*) INTO v_from FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_from;
    SELECT COUNT(*) INTO v_to FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_to;
    IF v_from = 1 AND v_to = 0 THEN
      SET @licigov_pb_ddl = CONCAT('ALTER TABLE `', p_tbl, '` RENAME COLUMN `', p_from, '` TO `', p_to, '`');
      PREPARE licigov_pb_stmt FROM @licigov_pb_ddl;
      EXECUTE licigov_pb_stmt;
      DEALLOCATE PREPARE licigov_pb_stmt;
    ELSEIF v_from = 1 AND v_to = 1 THEN
      SET @licigov_pb_msg = CONCAT('[0297] rename ambiguo em ', p_tbl, '.', p_from, ' -> ', p_to, ': ambas as colunas existem');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @licigov_pb_msg;
    ELSEIF v_from = 0 AND v_to = 0 THEN
      SET @licigov_pb_msg = CONCAT('[0297] rename impossivel em ', p_tbl, ': nem ', p_from, ' nem ', p_to, ' existem');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = @licigov_pb_msg;
    END IF;
  END IF;
END
--> statement-breakpoint
CALL licigov_pb_rename_col('department_permissions', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('environments', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('environments', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('extraction_evidence', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('extraction_evidence', 'import_session_id', 'importSessionId')
--> statement-breakpoint
CALL licigov_pb_rename_col('extraction_evidence', 'organization_id', 'organizationId')
--> statement-breakpoint
CALL licigov_pb_rename_col('extraction_evidence', 'staging_item_id', 'stagingItemId')
--> statement-breakpoint
CALL licigov_pb_rename_col('extraction_evidence', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'item_count', 'itemCount')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'organization_id', 'organizationId')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'period_end', 'periodEnd')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'period_start', 'periodStart')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_analytics_snapshots', 'session_count', 'sessionCount')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'actor_agent_id', 'actorAgentId')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'actor_org_id', 'actorOrgId')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'actor_type', 'actorType')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'actor_user_id', 'actorUserId')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'from_state', 'fromState')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'occurred_at', 'occurredAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'staging_item_id', 'stagingItemId')
--> statement-breakpoint
CALL licigov_pb_rename_col('import_review_transitions', 'to_state', 'toState')
--> statement-breakpoint
CALL licigov_pb_rename_col('operational_feedback', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('operational_health_snapshots', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('operational_templates', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('operational_templates', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'description_confidence', 'descriptionConfidence')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'likelihood_footer_rows', 'likelihoodFooterRows')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'likelihood_merged_headers', 'likelihoodMergedHeaders')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'parser_type', 'parserType')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'parser_version', 'parserVersion')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'price_confidence', 'priceConfidence')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'quantity_confidence', 'quantityConfidence')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'registered_at', 'registeredAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'requires_manual_price_review', 'requiresManualPriceReview')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'requires_manual_unit_review', 'requiresManualUnitReview')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_footers', 'supportsFooters')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_formulas', 'supportsFormulas')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_headers', 'supportsHeaders')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_images', 'supportsImages')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_merged_cells', 'supportsMergedCells')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_multi_page', 'supportsMultiPage')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'supports_multi_sheet', 'supportsMultiSheet')
--> statement-breakpoint
CALL licigov_pb_rename_col('parser_capabilities', 'unit_confidence', 'unitConfidence')
--> statement-breakpoint
CALL licigov_pb_rename_col('pilot_execution_snapshots', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('pilot_execution_snapshots', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('pilot_organizations', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('pilot_organizations', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('pilot_readiness_scores', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'catmat_code', 'catmatCode')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'evaluated_at', 'evaluatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'evaluated_by', 'evaluatedBy')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'explanation_matched', 'explanationMatched')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'explanation_reason', 'explanationReason')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'generated_at', 'generatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'import_session_id', 'importSessionId')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'index_entry_id', 'indexEntryId')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'organization_id', 'organizationId')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'original_raw', 'originalRaw')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'proposed_description', 'proposedDescription')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'proposed_quantity', 'proposedQuantity')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'proposed_unit', 'proposedUnit')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'proposed_unit_price', 'proposedUnitPrice')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_candidates', 'staging_item_id', 'stagingItemId')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'canonical_text', 'canonicalText')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'catmat_code', 'catmatCode')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'display_text', 'displayText')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'is_active', 'isActive')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'organization_id', 'organizationId')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'synonym_tokens', 'synonymTokens')
--> statement-breakpoint
CALL licigov_pb_rename_col('semantic_search_entries', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('support_incidents', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('support_incidents', 'updated_at', 'updatedAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('training_analytics', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('ux_events', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('workflow_analytics_snapshots', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('workflow_permissions', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_rename_col('workload_metrics', 'created_at', 'createdAt')
--> statement-breakpoint
CALL licigov_pb_add_col('clause_knowledge', 'active', 'tinyint NOT NULL DEFAULT 1')
--> statement-breakpoint
CALL licigov_pb_add_col('clause_knowledge', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('clause_knowledge', 'prerequisites', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('clause_knowledge', 'purpose', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('clause_knowledge', 'related_document_types', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('contract_addenda', 'request_origin', 'varchar(30) NOT NULL DEFAULT ''contract_workspace''')
--> statement-breakpoint
CALL licigov_pb_add_col('contract_ws_documents', 'metadata', 'TEXT NULL')
--> statement-breakpoint
CALL licigov_pb_add_col('entity_resolutions', 'confidence', 'decimal(5,4) NOT NULL DEFAULT ''0.5''')
--> statement-breakpoint
CALL licigov_pb_add_col('entity_resolutions', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('extraction_evidence', 'provenanceCol', 'varchar(32)')
--> statement-breakpoint
CALL licigov_pb_add_col('extraction_evidence', 'provenancePage', 'int')
--> statement-breakpoint
CALL licigov_pb_add_col('extraction_evidence', 'provenanceRow', 'int')
--> statement-breakpoint
CALL licigov_pb_add_col('extraction_evidence', 'provenanceSheet', 'varchar(128)')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_change_log', 'changed_by', 'varchar(255) NOT NULL DEFAULT ''system''')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_change_log', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_change_log', 'created_at', 'datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_metrics', 'created_at', 'datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_metrics', 'metric_unit', 'varchar(50) NOT NULL DEFAULT ''count''')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_versions', 'change_summary', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('graph_versions', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'alinea', 'varchar(100)')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'ano', 'int NOT NULL DEFAULT 0')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'artigo', 'varchar(100)')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'ementa', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'numero', 'varchar(50) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'orgao', 'varchar(255) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'texto', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('legal_reference_nodes', 'vigencia', 'varchar(50) NOT NULL DEFAULT ''vigente''')
--> statement-breakpoint
CALL licigov_pb_add_col('ontology_taxonomy', 'aliases', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('ontology_taxonomy', 'category', 'varchar(50) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('ontology_taxonomy', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('ontology_taxonomy', 'definition', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('ontology_taxonomy', 'legal_basis', 'varchar(500) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('process_members', 'functionalRole', 'enum(''solicitante'',''compras'',''juridico'',''controle_interno'',''gestor'',''fiscal'',''administrador'')')
--> statement-breakpoint
CALL licigov_pb_add_col('procurement_concepts', 'correlation_id', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('procurement_concepts', 'examples', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('procurement_concepts', 'parent_concept_id', 'varchar(20)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_candidates', 'catmatDesc', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_candidates', 'catmatGroup', 'varchar(128)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_candidates', 'explanationBonus', 'decimal(4,3) DEFAULT ''0''')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_candidates', 'explanationPenalty', 'decimal(4,3) DEFAULT ''0''')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'content', 'text')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'document_type', 'varchar(50) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'legal_ref', 'varchar(255)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'lineage', 'json')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'metadata', 'json')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'overlap_with_prev', 'int NOT NULL DEFAULT 0')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'replay_key', 'varchar(64) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'section_title', 'varchar(255)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'strategy', 'varchar(50) NOT NULL DEFAULT ''''')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_chunks', 'total_chunks', 'int NOT NULL DEFAULT 0')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_search_entries', 'catmatClass', 'varchar(128)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_search_entries', 'catmatGroup', 'varchar(128)')
--> statement-breakpoint
CALL licigov_pb_add_col('semantic_search_entries', 'lastSeenAt', 'timestamp')
--> statement-breakpoint
CALL licigov_pb_add_col('users', 'tokenVersion', 'int NOT NULL DEFAULT 0')
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_pb_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_pb_rename_col
