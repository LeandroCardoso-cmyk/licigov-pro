-- 0316 — Institutional Document Templates (T2): persistência do bounded context (organization-only, V1).
--
-- Estruturas (6 tabelas NOVAS; nenhuma tabela existente é lida, copiada ou alterada):
--   institutional_template_identities   identidade do modelo (imutável)
--   institutional_template_revisions    revisão append-only; PUBLISHED imutável; lifecycle DRAFT→APPROVED→PUBLISHED→DEPRECATED
--   institutional_template_bindings     binding determinístico com PIN exato da revisão; no máximo 1 ativo por escopo
--   institutional_template_events       ledger append-only do ciclo de vida
--   document_composition_manifests      Composition Manifest INSERT-only (M1 GENERATION e M2 ISSUANCE são registros distintos)
--   document_composition_references     referências oficiais pinadas do manifest
--
-- HD-26 (Option A, decidida pelo owner) — CROSS_TENANT_RELATIONSHIP_MUST_BE_IMPOSSIBLE:
--  - organization_id NOT NULL em TODAS as tabelas; NULL nunca significa global; não existe PLATFORM_GLOBAL;
--  - entre tabelas NOVAS: UNIQUE (organization_id, id) no pai + FK COMPOSTA que contém organization_id; índice
--    correspondente no filho; colunas das relações obrigatórias são NOT NULL;
--  - TODA FK é ON DELETE RESTRICT / ON UPDATE RESTRICT (nunca CASCADE): lineage, replay, manifest e auditoria preservados;
--  - relações com tabelas EXISTENTES (generated_documents, official_documents, institutional_decisions) NÃO têm FK nem
--    DDL nos pais: são validadas por id + tenant, fail-closed, na MESMA transação da escrita (server/db/institutionalTemplates);
--  - charset/colação explícitos e idênticos em todas as tabelas (utf8mb4_unicode_ci, padrão das tabelas canônicas).
--
-- Chaves geradas (STORED, utf8mb4_bin — mesmo padrão da 0313):
--  - institutional_template_bindings.active_scope_key: só preenchida quando active = 1; UNIQUE(organization_id,
--    active_scope_key) ⇒ no máximo UM binding ATIVO por (organização, tipo, escopo) — ambiguidade estrutural impossível;
--  - document_composition_manifests.official_issue_key: só no estágio ISSUANCE; UNIQUE(organization_id, official_issue_key)
--    ⇒ um manifest de emissão por versão oficial (INV-TPL-29).
--
-- Puramente ADITIVA e SEM BACKFILL. REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, com as FKs INLINE (uma tabela nunca existe sem
-- as suas FKs); a ordem é pai → filho, então um estado parcial (falha no meio) é sempre "tabelas completas que faltam" e a
-- reaplicação conclui sem alterar o que já existe. Versão anterior da aplicação ignora as tabelas novas.
-- ROLLBACK: DROP TABLE na ordem inversa (references, manifests, events, bindings, revisions, identities). Nenhum dado de outra
-- tabela é afetado.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutional_template_identities` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`document_kind` varchar(16) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`created_at_iso` varchar(40) NOT NULL,
	`created_by_user_id` int NOT NULL,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `institutional_template_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_iti_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_iti_org_kind_slug` UNIQUE(`organization_id`,`document_kind`,`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutional_template_revisions` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`identity_id` varchar(24) NOT NULL,
	`revision` int NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'DRAFT',
	`ast_json` longtext NOT NULL,
	`variable_catalog_version` varchar(64) NOT NULL,
	`semantic_hash` varchar(64) NOT NULL,
	`hash_version` varchar(16) NOT NULL,
	`source_format` varchar(24) NOT NULL,
	`approval_decision_id` varchar(24),
	`publish_decision_id` varchar(24),
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `institutional_template_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_itr_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_itr_org_identity_id` UNIQUE(`organization_id`,`identity_id`,`id`),
	CONSTRAINT `uq_itr_org_identity_rev` UNIQUE(`organization_id`,`identity_id`,`revision`),
	KEY `idx_itr_org_status` (`organization_id`,`status`),
	CONSTRAINT `fk_itr_identity` FOREIGN KEY (`organization_id`,`identity_id`) REFERENCES `institutional_template_identities`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutional_template_bindings` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`document_kind` varchar(16) NOT NULL,
	`scope_modality` varchar(64) NOT NULL DEFAULT '',
	`scope_regime` varchar(64) NOT NULL DEFAULT '',
	`scope_criterion` varchar(64) NOT NULL DEFAULT '',
	`identity_id` varchar(24) NOT NULL,
	`pinned_revision_id` varchar(24) NOT NULL,
	`active` tinyint NOT NULL DEFAULT 1,
	`effective_from_iso` varchar(40) NOT NULL,
	`active_scope_key` varchar(224) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
		GENERATED ALWAYS AS (if((`active` = 1),concat_ws('|',`document_kind`,`scope_modality`,`scope_regime`,`scope_criterion`),NULL)) STORED,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `institutional_template_bindings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_itb_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_itb_active_scope` UNIQUE(`organization_id`,`active_scope_key`),
	KEY `idx_itb_org_kind_active` (`organization_id`,`document_kind`,`active`),
	KEY `idx_itb_org_identity_revision` (`organization_id`,`identity_id`,`pinned_revision_id`),
	CONSTRAINT `fk_itb_identity` FOREIGN KEY (`organization_id`,`identity_id`) REFERENCES `institutional_template_identities`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
	CONSTRAINT `fk_itb_revision` FOREIGN KEY (`organization_id`,`identity_id`,`pinned_revision_id`) REFERENCES `institutional_template_revisions`(`organization_id`,`identity_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutional_template_events` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`identity_id` varchar(24) NOT NULL,
	`revision_id` varchar(24),
	`binding_id` varchar(24),
	`event_type` varchar(32) NOT NULL,
	`from_status` varchar(16) NOT NULL DEFAULT '',
	`to_status` varchar(16) NOT NULL DEFAULT '',
	`decision_id` varchar(24),
	`actor_user_id` int NOT NULL,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `institutional_template_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ite_org_id` UNIQUE(`organization_id`,`id`),
	KEY `idx_ite_org_identity` (`organization_id`,`identity_id`),
	KEY `idx_ite_org_revision` (`organization_id`,`revision_id`),
	KEY `idx_ite_org_binding` (`organization_id`,`binding_id`),
	CONSTRAINT `fk_ite_identity` FOREIGN KEY (`organization_id`,`identity_id`) REFERENCES `institutional_template_identities`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
	CONSTRAINT `fk_ite_revision` FOREIGN KEY (`organization_id`,`revision_id`) REFERENCES `institutional_template_revisions`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
	CONSTRAINT `fk_ite_binding` FOREIGN KEY (`organization_id`,`binding_id`) REFERENCES `institutional_template_bindings`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_composition_manifests` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`stage` varchar(16) NOT NULL,
	`generated_document_id` varchar(20) NOT NULL,
	`official_document_id` varchar(20),
	`template_identity_id` varchar(24) NOT NULL,
	`template_revision_id` varchar(24) NOT NULL,
	`template_semantic_hash` varchar(64) NOT NULL,
	`hash_version` varchar(16) NOT NULL,
	`catalog_version` varchar(64) NOT NULL,
	`identity_fingerprint` varchar(64) NOT NULL,
	`composed_output_hash` varchar(64) NOT NULL,
	`document_content_hash` varchar(64),
	`derived_from_manifest_id` varchar(24),
	`manifest_hash` varchar(64) NOT NULL,
	`manifest_created_at_iso` varchar(40) NOT NULL,
	`body_json` longtext NOT NULL,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`official_issue_key` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
		GENERATED ALWAYS AS (if((`stage` = 'ISSUANCE'),`official_document_id`,NULL)) STORED,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `document_composition_manifests_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dcm_org_id` UNIQUE(`organization_id`,`id`),
	CONSTRAINT `uq_dcm_org_hash` UNIQUE(`organization_id`,`manifest_hash`),
	CONSTRAINT `uq_dcm_org_issue` UNIQUE(`organization_id`,`official_issue_key`),
	KEY `idx_dcm_org_generated` (`organization_id`,`generated_document_id`),
	KEY `idx_dcm_org_revision` (`organization_id`,`template_identity_id`,`template_revision_id`),
	KEY `idx_dcm_org_derived` (`organization_id`,`derived_from_manifest_id`),
	CONSTRAINT `fk_dcm_revision` FOREIGN KEY (`organization_id`,`template_identity_id`,`template_revision_id`) REFERENCES `institutional_template_revisions`(`organization_id`,`identity_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
	CONSTRAINT `fk_dcm_derived` FOREIGN KEY (`organization_id`,`derived_from_manifest_id`) REFERENCES `document_composition_manifests`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_composition_references` (
	`organization_id` int NOT NULL,
	`manifest_id` varchar(24) NOT NULL,
	`ref_order` int NOT NULL,
	`role` varchar(64) NOT NULL,
	`document_id` varchar(20) NOT NULL,
	`lineage_id` varchar(20) NOT NULL,
	`version` int NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `pk_dcr` PRIMARY KEY(`organization_id`,`manifest_id`,`ref_order`),
	KEY `idx_dcr_org_document` (`organization_id`,`document_id`),
	CONSTRAINT `fk_dcr_manifest` FOREIGN KEY (`organization_id`,`manifest_id`) REFERENCES `document_composition_manifests`(`organization_id`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
