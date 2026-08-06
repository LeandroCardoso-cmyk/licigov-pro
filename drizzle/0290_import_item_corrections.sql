-- 0290 — PR B.2.2: correção humana AUDITÁVEL de itens de staging (migration ADITIVA e
-- RECONCILIADORA). Adiciona a projeção atual da correção em `import_staging_items` (overlay sobre
-- os `raw*` IMUTÁVEIS) e a tabela de histórico imutável `import_item_corrections`.
--
-- Regras: colunas NULLABLE/aditivas (exceto correctionRevision INT NOT NULL DEFAULT 0, compatível
-- com linhas históricas). SEM backfill; SEM apagar/reinterpretar dados. Compatível com banco novo e
-- existente. Idempotente: consulta o INFORMATION_SCHEMA e só monta a DDL quando necessário
-- (PREPARE/EXECUTE/DEALLOCATE — 1 statement por chunk; migrator sem multipleStatements). Ownership do
-- processo canônico permanece validado na aplicação (sem FK, convenção de procurement_processes).

-- ── import_staging_items.correctionRevision INT NOT NULL DEFAULT 0 ────────────────────────────────
SET @sql_0290_rev := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_staging_items` ADD `correctionRevision` int NOT NULL DEFAULT 0'
    WHEN SUM(DATA_TYPE = 'int') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0290_import_staging_items_correctionRevision_deve_ser_int`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_staging_items' AND COLUMN_NAME = 'correctionRevision');
--> statement-breakpoint
PREPARE stmt_0290_rev FROM @sql_0290_rev;
--> statement-breakpoint
EXECUTE stmt_0290_rev;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0290_rev;
--> statement-breakpoint
-- ── import_staging_items.correctedPayload JSON NULL ──────────────────────────────────────────────
SET @sql_0290_payload := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_staging_items` ADD `correctedPayload` json'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_staging_items' AND COLUMN_NAME = 'correctedPayload');
--> statement-breakpoint
PREPARE stmt_0290_payload FROM @sql_0290_payload;
--> statement-breakpoint
EXECUTE stmt_0290_payload;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0290_payload;
--> statement-breakpoint
-- ── import_staging_items.correctedAt TIMESTAMP NULL ──────────────────────────────────────────────
SET @sql_0290_at := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_staging_items` ADD `correctedAt` timestamp NULL'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_staging_items' AND COLUMN_NAME = 'correctedAt');
--> statement-breakpoint
PREPARE stmt_0290_at FROM @sql_0290_at;
--> statement-breakpoint
EXECUTE stmt_0290_at;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0290_at;
--> statement-breakpoint
-- ── import_staging_items.correctedByUserId INT NULL (compatível com users.id) ────────────────────
SET @sql_0290_by := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_staging_items` ADD `correctedByUserId` int'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_staging_items' AND COLUMN_NAME = 'correctedByUserId');
--> statement-breakpoint
PREPARE stmt_0290_by FROM @sql_0290_by;
--> statement-breakpoint
EXECUTE stmt_0290_by;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0290_by;
--> statement-breakpoint
-- ── tabela de histórico imutável import_item_corrections (idempotente: IF NOT EXISTS) ────────────
-- Índices: (org, item, revisão) UNIQUE — garante unicidade da revisão de um item no tenant;
-- (org, sessão); (org, processo); (org, chave idempotente) UNIQUE — idempotência tenant-aware.
CREATE TABLE IF NOT EXISTS `import_item_corrections` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `organizationId`       INT           NOT NULL,
  `procurementProcessId` VARCHAR(20),
  `importSessionId`      INT           NOT NULL,
  `stagingItemId`        INT           NOT NULL,
  `fromRevision`         INT           NOT NULL,
  `toRevision`           INT           NOT NULL,
  `beforePayload`        JSON,
  `afterPayload`         JSON,
  `changedFields`        JSON,
  `justification`        TEXT          NOT NULL,
  `actorUserId`          INT,
  `idempotencyKey`       VARCHAR(64),
  `correlationId`        VARCHAR(36),
  `createdAt`            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_correction_revision` (`organizationId`, `stagingItemId`, `toRevision`),
  UNIQUE KEY `uq_item_correction_idem`     (`organizationId`, `idempotencyKey`),
  INDEX `idx_item_correction_session`  (`organizationId`, `importSessionId`),
  INDEX `idx_item_correction_process`  (`organizationId`, `procurementProcessId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
