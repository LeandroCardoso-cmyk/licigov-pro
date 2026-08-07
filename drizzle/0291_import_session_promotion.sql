-- 0291 — PR B.2.4: promoção transacional e supervisionada do staging aprovado ao domínio canônico
-- (migration ADITIVA e RECONCILIADORA). Adiciona a PROJEÇÃO de estado de promoção em
-- `import_sessions` e o LEDGER imutável `import_promotions` (uma promoção por sessão, idempotente).
--
-- Regras: colunas NULLABLE/aditivas (exceto promotionStatus VARCHAR(20) NOT NULL DEFAULT 'none',
-- compatível com linhas históricas). SEM backfill; SEM apagar/reinterpretar dados. Idempotente:
-- consulta o INFORMATION_SCHEMA e só monta a DDL quando necessário (PREPARE/EXECUTE/DEALLOCATE — 1
-- statement por chunk; migrator sem multipleStatements). Ownership do processo canônico permanece
-- validado na aplicação (sem FK, convenção de procurement_processes).

-- ── import_sessions.promotionStatus VARCHAR(20) NOT NULL DEFAULT 'none' ───────────────────────────
SET @sql_0291_status := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `promotionStatus` varchar(20) NOT NULL DEFAULT ''none'''
    WHEN SUM(DATA_TYPE = 'varchar') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0291_import_sessions_promotionStatus_deve_ser_varchar`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions' AND COLUMN_NAME = 'promotionStatus');
--> statement-breakpoint
PREPARE stmt_0291_status FROM @sql_0291_status;
--> statement-breakpoint
EXECUTE stmt_0291_status;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0291_status;
--> statement-breakpoint
-- ── import_sessions.promotedAt TIMESTAMP NULL ────────────────────────────────────────────────────
SET @sql_0291_at := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `promotedAt` timestamp NULL'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions' AND COLUMN_NAME = 'promotedAt');
--> statement-breakpoint
PREPARE stmt_0291_at FROM @sql_0291_at;
--> statement-breakpoint
EXECUTE stmt_0291_at;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0291_at;
--> statement-breakpoint
-- ── import_sessions.promotedByUserId INT NULL ────────────────────────────────────────────────────
SET @sql_0291_by := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `promotedByUserId` int'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions' AND COLUMN_NAME = 'promotedByUserId');
--> statement-breakpoint
PREPARE stmt_0291_by FROM @sql_0291_by;
--> statement-breakpoint
EXECUTE stmt_0291_by;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0291_by;
--> statement-breakpoint
-- ── import_sessions.promotionRef VARCHAR(20) NULL (id do agregado de domínio criado) ─────────────
SET @sql_0291_ref := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `promotionRef` varchar(20)'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'import_sessions' AND COLUMN_NAME = 'promotionRef');
--> statement-breakpoint
PREPARE stmt_0291_ref FROM @sql_0291_ref;
--> statement-breakpoint
EXECUTE stmt_0291_ref;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0291_ref;
--> statement-breakpoint
-- ── ledger imutável import_promotions (idempotente: IF NOT EXISTS) ───────────────────────────────
-- Índices: (org, sessão) UNIQUE — UMA promoção por sessão (impede dupla promoção); (org, chave
-- idempotente) UNIQUE — idempotência tenant-aware; (org, processo) para consulta por processo.
CREATE TABLE IF NOT EXISTS `import_promotions` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `organizationId`       INT           NOT NULL,
  `procurementProcessId` VARCHAR(20),
  `importSessionId`      INT           NOT NULL,
  `importType`           VARCHAR(30)   NOT NULL,
  `targetKind`           VARCHAR(30)   NOT NULL,
  `targetRef`            VARCHAR(20),
  `itemsPromoted`        INT           NOT NULL DEFAULT 0,
  `idempotencyKey`       VARCHAR(64),
  `correlationId`        VARCHAR(36),
  `actorUserId`          INT,
  `createdAt`            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_import_promotion_session` (`organizationId`, `importSessionId`),
  UNIQUE KEY `uq_import_promotion_idem`    (`organizationId`, `idempotencyKey`),
  INDEX `idx_import_promotion_process`     (`organizationId`, `procurementProcessId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
