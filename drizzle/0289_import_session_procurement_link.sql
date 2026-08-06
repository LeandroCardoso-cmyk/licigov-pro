-- 0289 — PR B.2.2: vínculo da sessão de ingestão ao PROCESSO CANÔNICO (migration ADITIVA e
-- RECONCILIADORA). Adiciona `procurementProcessId varchar(20)` (mesmo tipo do
-- `procurement_processes.id`) e o índice tenant-aware `(organizationId, procurementProcessId)`.
--
-- Semanticamente SEPARADO do `processId` legado (int → tabela `processes`): NÃO reutiliza o mesmo
-- campo com dois significados. Coluna NULLABLE (aditiva; compatível com linhas históricas; SEM
-- backfill). Ownership é validado no serviço por (procurementProcessId + organizationId) — segue a
-- convenção do projeto (process_stages/price_research referenciam o processo por varchar+org, sem FK
-- de banco), preservando baixo acoplamento e integridade referencial em nível de aplicação.
--
-- Idempotente (mesmo racional da 0288): o migrator roda cada chunk como UMA query via mysql2 sem
-- multipleStatements e o MySQL não tem `ADD COLUMN IF NOT EXISTS` — consulta o INFORMATION_SCHEMA e
-- monta a DDL só quando necessário (PREPARE/EXECUTE/DEALLOCATE, 1 statement por chunk). Compatível
-- com banco novo e existente. Se a coluna já existir incompatível, ABORTA de forma acionável.

-- ── procurementProcessId VARCHAR(20) NULL ────────────────────────────────────────────────────────
SET @sql_0289_procproc := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `procurementProcessId` varchar(20)'
    WHEN SUM(DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 20 AND IS_NULLABLE = 'YES') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0289_import_sessions_procurementProcessId_deve_ser_varchar_20_e_nulavel`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND COLUMN_NAME  = 'procurementProcessId');
--> statement-breakpoint
PREPARE stmt_0289_procproc FROM @sql_0289_procproc;
--> statement-breakpoint
EXECUTE stmt_0289_procproc;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0289_procproc;
--> statement-breakpoint
-- ── índice tenant-aware (organizationId, procurementProcessId) ────────────────────────────────────
SET @sql_0289_idx := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD INDEX `import_sessions_org_procproc_idx` (`organizationId`,`procurementProcessId`)'
    ELSE 'SELECT 1'
  END
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND INDEX_NAME   = 'import_sessions_org_procproc_idx');
--> statement-breakpoint
PREPARE stmt_0289_idx FROM @sql_0289_idx;
--> statement-breakpoint
EXECUTE stmt_0289_idx;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0289_idx;
