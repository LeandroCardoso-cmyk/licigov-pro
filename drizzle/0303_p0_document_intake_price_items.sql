-- 0303 — P0 piloto: DOCUMENT INTAKE (DFD/ETP/TR) + campos de cotação + enriquecimento de Itens Inteligentes.
--
-- Puramente ADITIVA / ALARGADORA — nenhum DROP, nenhum backfill, nenhuma perda de dados:
--   1) cria `import_document_staging` (staging documental do MESMO Import Engine; 1 linha por sessão);
--   2) alarga `generated_documents.content` TEXT → LONGTEXT (documento importado real pode passar de 64 KB);
--   3) adiciona à `import_staging_items` os campos de cotação de 1ª classe (fornecedor/marca/modelo/obs./fonte);
--   4) adiciona `intelligent_items.enrichment_status` (default 'done' para linhas preexistentes).
--
-- REPLAY-SAFE / PRECONDITION-SAFE: cada ADD é guardado por INFORMATION_SCHEMA (MySQL 8 não tem
-- ADD COLUMN/CREATE INDEX IF NOT EXISTS) — reexecução em banco já convergido é no-op. CREATE TABLE usa
-- IF NOT EXISTS; MODIFY para LONGTEXT é idempotente. Compatível com MySQL 8.4 e MariaDB (sem SIGNAL).
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0303_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0303_add_idx
--> statement-breakpoint
CREATE PROCEDURE licigov_0303_add_col(IN p_tbl VARCHAR(64), IN p_col VARCHAR(64), IN p_def TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_col) = 0 THEN
    SET @licigov_0303_ddl = CONCAT('ALTER TABLE `', p_tbl, '` ADD COLUMN `', p_col, '` ', p_def);
    PREPARE licigov_0303_stmt FROM @licigov_0303_ddl;
    EXECUTE licigov_0303_stmt;
    DEALLOCATE PREPARE licigov_0303_stmt;
  END IF;
END
--> statement-breakpoint
CREATE PROCEDURE licigov_0303_add_idx(IN p_tbl VARCHAR(64), IN p_idx VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND INDEX_NAME = p_idx) = 0 THEN
    SET @licigov_0303_ddl = CONCAT('CREATE INDEX `', p_idx, '` ON `', p_tbl, '` (', p_cols, ')');
    PREPARE licigov_0303_stmt FROM @licigov_0303_ddl;
    EXECUTE licigov_0303_stmt;
    DEALLOCATE PREPARE licigov_0303_stmt;
  END IF;
END
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `import_document_staging` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`procurementProcessId` varchar(20) NOT NULL,
	`importSessionId` int NOT NULL,
	`documentKind` varchar(10) NOT NULL,
	`originalFileName` varchar(255) NOT NULL,
	`sourceChecksum` varchar(64) NOT NULL DEFAULT '',
	`parserType` varchar(20) NOT NULL,
	`parserVersion` varchar(20) NOT NULL,
	`projectionVersion` varchar(40) NOT NULL,
	`rawContent` longtext NOT NULL,
	`rawContentHash` varchar(64) NOT NULL,
	`rawBlocks` json,
	`reviewedContent` longtext,
	`contentHash` varchar(64) NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`status` varchar(20) NOT NULL DEFAULT 'pending_review',
	`warnings` json,
	`reviewedBy` int,
	`reviewedAt` timestamp NULL,
	`approvedBy` int,
	`approvedAt` timestamp NULL,
	`approvedContentHash` varchar(64),
	`promotedBy` int,
	`promotedAt` timestamp NULL,
	`promotionMode` varchar(20),
	`targetDocumentId` varchar(20),
	`correlationId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `import_document_staging_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_import_doc_staging_session` UNIQUE(`organizationId`,`importSessionId`)
)
--> statement-breakpoint
CALL licigov_0303_add_idx('import_document_staging', 'idx_import_doc_staging_process', '`organizationId`,`procurementProcessId`,`documentKind`')
--> statement-breakpoint
ALTER TABLE `generated_documents` MODIFY COLUMN `content` longtext
--> statement-breakpoint
CALL licigov_0303_add_col('import_staging_items', 'rawSupplier', 'varchar(255)')
--> statement-breakpoint
CALL licigov_0303_add_col('import_staging_items', 'rawBrand', 'varchar(255)')
--> statement-breakpoint
CALL licigov_0303_add_col('import_staging_items', 'rawModel', 'varchar(255)')
--> statement-breakpoint
CALL licigov_0303_add_col('import_staging_items', 'rawNotes', 'text')
--> statement-breakpoint
CALL licigov_0303_add_col('import_staging_items', 'rawSource', 'varchar(255)')
--> statement-breakpoint
CALL licigov_0303_add_col('intelligent_items', 'enrichment_status', 'varchar(20) NOT NULL DEFAULT ''done''')
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0303_add_col
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0303_add_idx
