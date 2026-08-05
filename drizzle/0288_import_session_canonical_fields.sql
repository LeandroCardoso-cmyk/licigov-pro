-- 0288 — PR B.2.1: campos canônicos de ingestão em `import_sessions` (migration RECONCILIADORA).
--
-- Formal, versionada e AUDITÁVEL. Reconcilia três estados reais do banco, sem intervenção manual:
--   A. banco novo, sem os campos               → adiciona coluna/índice ausentes;
--   B. banco transitório com os campos já criados por um ensureSchema anterior (commit 91bd893,
--      antes da migration formal) → NÃO recria (evita ER_DUP_FIELDNAME); apenas valida e completa o
--      que faltar (ex.: o índice de dedup, que o ensureSchema antigo não criava);
--   C. execução repetida/concorrente            → idempotente (nunca dupla alteração).
--
-- Como o migrator do drizzle roda cada chunk como UMA query via mysql2 SEM multipleStatements
-- (ver server/__tests__/integration/migrations-chain.test.ts) e o MySQL não tem `ADD COLUMN IF NOT
-- EXISTS`, a idempotência é feita com SQL dinâmico: cada coluna/índice consulta o INFORMATION_SCHEMA
-- e monta a DDL só quando necessário (PREPARE/EXECUTE/DEALLOCATE — 1 statement por chunk).
--
-- Regras preservadas: colunas NULLABLE (compatível com linhas históricas; SEM backfill especulativo);
-- checksum = sha256 calculado pelo SERVIDOR (valor do cliente é só expectativa a validar);
-- processId = vínculo/lineage com o processo (`int`, compatível com `processes.id`; ownership validado
-- no serviço por processId + organizationId); importPurpose = finalidade da importação; índice
-- tenant-aware NÃO exclusivo `(organizationId, checksum)` — o mesmo checksum reaparece em re-import
-- legítimo (após rejeição/arquivamento): NENHUMA unicidade global por checksum.
--
-- Compatibilidade EXPLÍCITA e limitada à 0288 (nunca um catch genérico de ER_DUP_FIELDNAME): se uma
-- coluna/índice já existente for INCOMPATÍVEL (tipo, tamanho ou nulabilidade), a migration ABORTA de
-- forma acionável selecionando de uma tabela-sentinela inexistente cujo nome descreve o ajuste
-- esperado — nunca muta silenciosamente uma coluna divergente. O bootstrap (ensureSchema →
-- assertColumnsPresent) revalida tipo/nulabilidade após o migrate, como defesa em profundidade.

-- ── checksum VARCHAR(64) NULL ────────────────────────────────────────────────────────────────────
SET @sql_0288_checksum := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `checksum` varchar(64)'
    WHEN SUM(DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 64 AND IS_NULLABLE = 'YES') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0288_import_sessions_checksum_deve_ser_varchar_64_e_nulavel`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND COLUMN_NAME  = 'checksum');
--> statement-breakpoint
PREPARE stmt_0288_checksum FROM @sql_0288_checksum;
--> statement-breakpoint
EXECUTE stmt_0288_checksum;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0288_checksum;
--> statement-breakpoint
-- ── processId INT NULL (compatível com processes.id) ─────────────────────────────────────────────
SET @sql_0288_processId := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `processId` int'
    WHEN SUM(DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0288_import_sessions_processId_deve_ser_int_e_nulavel`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND COLUMN_NAME  = 'processId');
--> statement-breakpoint
PREPARE stmt_0288_processId FROM @sql_0288_processId;
--> statement-breakpoint
EXECUTE stmt_0288_processId;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0288_processId;
--> statement-breakpoint
-- ── importPurpose VARCHAR(50) NULL ───────────────────────────────────────────────────────────────
SET @sql_0288_importPurpose := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD `importPurpose` varchar(50)'
    WHEN SUM(DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 50 AND IS_NULLABLE = 'YES') = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0288_import_sessions_importPurpose_deve_ser_varchar_50_e_nulavel`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND COLUMN_NAME  = 'importPurpose');
--> statement-breakpoint
PREPARE stmt_0288_importPurpose FROM @sql_0288_importPurpose;
--> statement-breakpoint
EXECUTE stmt_0288_importPurpose;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0288_importPurpose;
--> statement-breakpoint
-- ── índice tenant-aware NÃO exclusivo (organizationId, checksum) ──────────────────────────────────
-- NON_UNIQUE = 1 → índice não exclusivo (esperado); = 0 → exclusivo (rejeitado: sem unicidade global).
SET @sql_0288_idx := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'ALTER TABLE `import_sessions` ADD INDEX `import_sessions_org_checksum_idx` (`organizationId`,`checksum`)'
    WHEN MIN(NON_UNIQUE) = 1
      THEN 'SELECT 1'
    ELSE 'SELECT 1 FROM `erro_0288_indice_org_checksum_deve_ser_nao_exclusivo`'
  END
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'import_sessions'
    AND INDEX_NAME   = 'import_sessions_org_checksum_idx');
--> statement-breakpoint
PREPARE stmt_0288_idx FROM @sql_0288_idx;
--> statement-breakpoint
EXECUTE stmt_0288_idx;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0288_idx;
