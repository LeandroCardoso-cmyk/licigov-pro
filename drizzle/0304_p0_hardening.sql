-- 0304 — P0 piloto HARDENING: contrato monetário tipado, convergência Pesquisa × Itens, reconciliação
-- legado→v2, deduplicação concorrente de promoção, ledger append-only da revisão documental e recuperação
-- durável do enriquecimento.
--
-- Puramente ADITIVA — nenhum DROP, nenhum backfill, nenhum dedupe arbitrário:
--   1) CREATE TABLE import_document_review_ledger (histórico imutável da revisão documental);
--   2) CREATE TABLE intelligent_item_identity_aliases (chave lógica v2 → item canônico, append-only);
--   3) import_staging_items.rawTypedValues (valor NATIVO de células numéricas);
--   4) intelligent_items: source_state/_reason/source_changed_at/pending_suppliers (convergência) e
--      enrichment_attempts/_last_attempt_at/_error_code (recuperação);
--   5) import_promotions.sourceChecksum + UNIQUE(organizationId, procurementProcessId, importType,
--      sourceChecksum). A coluna é NOVA e nullable: linhas preexistentes ficam NULL (NULL não colide em
--      UNIQUE) → não há dado incompatível possível. Se, num replay, existirem duplicatas NÃO-NULL (só por
--      escrita manual fora do sistema), o CREATE UNIQUE falha — FAIL-CLOSED, sem dedupe silencioso.
--
-- REPLAY-SAFE: ADD COLUMN / CREATE INDEX guardados por INFORMATION_SCHEMA; CREATE TABLE IF NOT EXISTS.
-- MySQL 8.4 e MariaDB (sem SIGNAL; cada procedure é um statement único sem ';' final).
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0304_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0304_add_idx
--> statement-breakpoint
CREATE PROCEDURE licigov_0304_add_col(IN p_tbl VARCHAR(64), IN p_col VARCHAR(64), IN p_def TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_col) = 0 THEN
    SET @licigov_0304_ddl = CONCAT('ALTER TABLE `', p_tbl, '` ADD COLUMN `', p_col, '` ', p_def);
    PREPARE licigov_0304_stmt FROM @licigov_0304_ddl;
    EXECUTE licigov_0304_stmt;
    DEALLOCATE PREPARE licigov_0304_stmt;
  END IF;
END
--> statement-breakpoint
CREATE PROCEDURE licigov_0304_add_idx(IN p_tbl VARCHAR(64), IN p_idx VARCHAR(64), IN p_kind VARCHAR(10), IN p_cols TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND INDEX_NAME = p_idx) = 0 THEN
    SET @licigov_0304_ddl = CONCAT('CREATE ', p_kind, ' INDEX `', p_idx, '` ON `', p_tbl, '` (', p_cols, ')');
    PREPARE licigov_0304_stmt FROM @licigov_0304_ddl;
    EXECUTE licigov_0304_stmt;
    DEALLOCATE PREPARE licigov_0304_stmt;
  END IF;
END
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_document_review_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`procurementProcessId` varchar(20) NOT NULL,
	`importSessionId` int NOT NULL,
	`documentStagingId` int NOT NULL,
	`documentKind` varchar(10) NOT NULL,
	`sequence` int NOT NULL,
	`revision` int NOT NULL,
	`eventType` varchar(30) NOT NULL,
	`actorUserId` int,
	`correlationId` varchar(64) NOT NULL DEFAULT '',
	`contentHash` varchar(64) NOT NULL,
	`previousContentHash` varchar(64),
	`contentSnapshot` longtext,
	`reason` text,
	`targetDocumentId` varchar(20),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `import_document_review_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_import_doc_review_seq` UNIQUE(`organizationId`,`documentStagingId`,`sequence`)
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `intelligent_item_identity_aliases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`logical_key_hash` varchar(64) NOT NULL,
	`logical_key` text NOT NULL,
	`item_id` varchar(20) NOT NULL,
	`resolution` varchar(20) NOT NULL,
	`actor_user_id` int,
	`reason` varchar(255),
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `intelligent_item_identity_aliases_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_iitem_alias_key` UNIQUE(`organization_id`,`process_id`,`logical_key_hash`)
)
--> statement-breakpoint
CALL licigov_0304_add_col('import_promotions', 'sourceChecksum', 'varchar(64) NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('import_staging_items', 'rawTypedValues', 'json NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'enrichment_attempts', 'int NOT NULL DEFAULT 0')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'enrichment_last_attempt_at', 'datetime(3) NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'enrichment_error_code', 'varchar(40) NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'source_state', 'varchar(20) NOT NULL DEFAULT ''current''')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'source_state_reason', 'varchar(255) NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'source_changed_at', 'datetime(3) NULL')
--> statement-breakpoint
CALL licigov_0304_add_col('intelligent_items', 'pending_suppliers', 'text NULL')
--> statement-breakpoint
CALL licigov_0304_add_idx('import_promotions', 'uq_import_promotions_source', 'UNIQUE', '`organizationId`,`procurementProcessId`,`importType`,`sourceChecksum`')
--> statement-breakpoint
CALL licigov_0304_add_idx('import_document_review_ledger', 'idx_import_doc_review_process', '', '`organizationId`,`procurementProcessId`,`documentKind`')
--> statement-breakpoint
CALL licigov_0304_add_idx('intelligent_item_identity_aliases', 'idx_iitem_alias_item', '', '`organization_id`,`item_id`')
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0304_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0304_add_idx
