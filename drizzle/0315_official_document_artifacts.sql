-- 0315 — R9 / SEM-043: ledger APPEND-ONLY dos ARTEFATOS renderizados (DOCX/PDF) de `official_documents`.
--
-- Antes: o export gravava `official_documents.storage_key/mime_type/size_bytes/content_hash` NA LINHA DA VERSÃO, então
-- exportar DOCX e depois PDF da MESMA versão sobrescrevia o ponteiro e o hash do primeiro artefato, e nenhum log
-- carregava o SHA do binário. Agora cada export registra uma linha aqui (e o evento `documento_exportado` da timeline
-- cita formato + hash). As colunas legadas da linha da versão deixam de ser escritas (ficam como histórico pré-0315).
--
-- Contrato:
--  - artifact_hash = sha256 dos BYTES renderizados; source_content_hash = sha256 de `official_documents.content` no
--    momento do export; source_replay_hash = `replay_hash` da versão; identity_fingerprint = identidade institucional
--    aplicada ao cabeçalho (quando disponível); created_by = ator humano `user:<id>` (nunca multi_copilot);
--  - UNIQUE(tenant_id, document_id, format, artifact_hash): reexportar bytes idênticos é idempotente (a aplicação
--    captura o duplicado e devolve a linha existente); bytes diferentes no mesmo formato ANEXAM nova linha; DOCX e PDF
--    nunca se sobrescrevem (o formato compõe a chave);
--  - a aplicação nunca faz UPDATE/DELETE nesta tabela (teste estático + smoke MySQL).
--
-- Puramente ADITIVA e SEM BACKFILL: CREATE TABLE IF NOT EXISTS (replay-safe; reaplicar = no-op). Nenhuma linha de
-- `official_documents` é lida, copiada ou alterada; versões exportadas antes da 0315 simplesmente NÃO têm linha aqui
-- (desconhecido ≠ inventado — a leitura tolera ausência). Tenant-scoped (tenant_id NOT NULL em todas as chaves).
-- Colação explícita utf8mb4_unicode_ci (padrão das tabelas canônicas).
-- ROLLBACK: `DROP TABLE official_document_artifacts` (somente a tabela nova; nenhum dado de outra tabela é afetado).
-- O build anterior ignora a tabela e continua escrevendo as colunas legadas.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `official_document_artifacts` (
	`id` varchar(24) NOT NULL,
	`tenant_id` int NOT NULL,
	`document_id` varchar(20) NOT NULL,
	`lineage_id` varchar(20) NOT NULL DEFAULT '',
	`version` int NOT NULL DEFAULT 1,
	`format` varchar(12) NOT NULL,
	`artifact_hash` varchar(64) NOT NULL,
	`size_bytes` int NOT NULL DEFAULT 0,
	`mime_type` varchar(120) NOT NULL DEFAULT '',
	`storage_key` varchar(255) NOT NULL DEFAULT '',
	`source_content_hash` varchar(64) NOT NULL DEFAULT '',
	`source_replay_hash` varchar(64) NOT NULL DEFAULT '',
	`identity_fingerprint` varchar(64) NOT NULL DEFAULT '',
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_by` varchar(60) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `official_document_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_oda_doc_format_hash` UNIQUE(`tenant_id`,`document_id`,`format`,`artifact_hash`),
	KEY `idx_oda_doc_format_created` (`tenant_id`,`document_id`,`format`,`created_at`),
	KEY `idx_oda_lineage` (`tenant_id`,`lineage_id`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
