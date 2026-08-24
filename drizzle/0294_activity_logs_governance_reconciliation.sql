-- 0294 — C.3A-OPS.2: reconciliação da nulabilidade de `activity_logs.processId` (RECONCILIADORA).
--
-- CAUSA (confirmada no código): bancos criados por `db:push` antigo têm o journal do Drizzle
-- baseline-stampado como "tudo aplicado" (ver server/bootstrap.ts: "O journal marca as migrations
-- como aplicadas, então o migrate() nunca as adiciona"). Por isso a 0041 — que fez
-- `ALTER TABLE activity_logs MODIFY processId int` (nullable) — NUNCA rodou nesses bancos; e o
-- `addColumnIfMissing` do ensureSchema apenas ADICIONA colunas ausentes, jamais altera a nulabilidade
-- de uma coluna PREEXISTENTE. Resultado: `activity_logs.processId` permanece `INT NOT NULL` e o INSERT
-- de auditoria governada da C.3A-OPS (processId = NULL, log organization-level) falha, derrubando por
-- rollback o override da feature flag. Uma migration ACIMA do baseline roda mesmo nesses bancos (ao
-- contrário da 0041) e reconcilia o drift. Em banco novo (onde a 0041 rodou) é um NO-OP comprovado.
--
-- Formal, versionada, idempotente e DATA-PRESERVING. Padrão idêntico ao da 0288: o migrator roda cada
-- chunk como UMA query via mysql2 SEM multipleStatements e o MySQL não tem MODIFY condicional, então a
-- idempotência é feita com SQL dinâmico via INFORMATION_SCHEMA (PREPARE/EXECUTE/DEALLOCATE — 1 statement
-- por chunk). SEM DROP, SEM DELETE, SEM backfill especulativo. `MODIFY ... int NULL` só relaxa a
-- nulabilidade e preserva integralmente os valores existentes.
--
-- Estados reconciliados:
--   A. banco novo (0041 aplicada)            → `processId` já `int` nullable → NO-OP;
--   B. banco já reconciliado                 → NO-OP;
--   C. banco histórico db:push (0041 pulada) → `processId` `int NOT NULL` → MODIFY para nullable;
--   D. coluna ausente/tipo divergente        → ABORTA de forma acionável (tabela-sentinela inexistente),
--      nunca muta silenciosamente algo divergente. O bootstrap (assertColumnsPresent) revalida depois.

-- ── activity_logs.processId INT NULL (log organization-level pode não ter processo) ────────────────
SET @sql_0294_processId := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'SELECT 1 FROM `erro_0294_activity_logs_processId_ausente_esperado_int_nulavel`'
    WHEN SUM(DATA_TYPE = 'int' AND IS_NULLABLE = 'YES') = 1
      THEN 'SELECT 1'
    WHEN SUM(DATA_TYPE = 'int' AND IS_NULLABLE = 'NO') = 1
      THEN 'ALTER TABLE `activity_logs` MODIFY `processId` int NULL'
    ELSE 'SELECT 1 FROM `erro_0294_activity_logs_processId_deve_ser_int_e_nulavel`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'activity_logs'
    AND COLUMN_NAME  = 'processId');
--> statement-breakpoint
PREPARE stmt_0294_processId FROM @sql_0294_processId;
--> statement-breakpoint
EXECUTE stmt_0294_processId;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0294_processId;
