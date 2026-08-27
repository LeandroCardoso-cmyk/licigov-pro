-- 0296 — C.4B.3A: fundação de PROVENIÊNCIA do rascunho + ledger de alterações (migration ADITIVA, idempotente).
--
-- Adiciona apenas artefatos NOVOS, sem DROP, sem DELETE, sem backfill especulativo, preservando
-- integralmente os dados existentes. Três efeitos:
--
--   1. `generated_documents.last_substantive_actor_user_id` (INT NULL) — último HUMANO responsável por
--      alteração MATERIAL do conteúdo atual (edição manual ou regeneração por IA solicitada por humano).
--      Junto de `author_user_id` (originador estável) é a base da SoD estendida da emissão oficial.
--
--   2. `generated_documents.last_substantive_at` (DATETIME(3) NULL) — quando ocorreu a última alteração
--      material.
--
--   3. `generated_document_edits` — LEDGER IMUTÁVEL (append-only) das alterações materiais do rascunho
--      canônico: quem alterou, de qual conteúdo (hash + `previous_content` para reconstrução/diff forense)
--      para qual conteúdo, e a operação (human_edit | ai_regenerate | dfd_manual_edit). NÃO acopla à
--      tabela legada `documents` (IDs int). Idempotente por (organization_id, idempotency_key).
--
-- Padrão idêntico ao das 0288/0294/0295: o migrator roda cada chunk como UMA query (mysql2 sem
-- multipleStatements) e o MySQL 8 não tem ADD COLUMN condicional, então a idempotência do ALTER é feita
-- com SQL dinâmico via INFORMATION_SCHEMA (PREPARE/EXECUTE/DEALLOCATE). O CREATE TABLE usa IF NOT EXISTS.
-- Isolamento multi-tenant validado na aplicação (convenção do projeto; sem FK).

-- ── generated_documents.last_substantive_actor_user_id INT NULL (aditivo idempotente) ──────────────
SET @sql_0296_lsa := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'SELECT 1 FROM `erro_0296_generated_documents_ausente`'
    WHEN SUM(COLUMN_NAME = 'last_substantive_actor_user_id') >= 1
      THEN 'SELECT 1'
    ELSE 'ALTER TABLE `generated_documents` ADD COLUMN `last_substantive_actor_user_id` int NULL AFTER `author_user_id`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'generated_documents');
--> statement-breakpoint
PREPARE stmt_0296_lsa FROM @sql_0296_lsa;
--> statement-breakpoint
EXECUTE stmt_0296_lsa;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0296_lsa;
--> statement-breakpoint
-- ── generated_documents.last_substantive_at DATETIME(3) NULL (aditivo idempotente) ─────────────────
SET @sql_0296_lsat := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'SELECT 1 FROM `erro_0296_generated_documents_ausente`'
    WHEN SUM(COLUMN_NAME = 'last_substantive_at') >= 1
      THEN 'SELECT 1'
    ELSE 'ALTER TABLE `generated_documents` ADD COLUMN `last_substantive_at` datetime(3) NULL AFTER `last_substantive_actor_user_id`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'generated_documents');
--> statement-breakpoint
PREPARE stmt_0296_lsat FROM @sql_0296_lsat;
--> statement-breakpoint
EXECUTE stmt_0296_lsat;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0296_lsat;
--> statement-breakpoint
-- ── generated_document_edits — ledger imutável de alteração material do rascunho ───────────────────
CREATE TABLE IF NOT EXISTS `generated_document_edits` (
  `id`                     INT           NOT NULL AUTO_INCREMENT,
  `organization_id`        INT           NOT NULL,
  `process_id`             VARCHAR(20)   NOT NULL,
  `generated_document_id`  VARCHAR(20)   NOT NULL,
  `kind`                   VARCHAR(20)   NOT NULL,
  `actor_user_id`          INT           NOT NULL,
  `previous_content_hash`  VARCHAR(64)   NOT NULL DEFAULT '',
  `new_content_hash`       VARCHAR(64)   NOT NULL,
  `previous_content`       LONGTEXT      NULL,
  `operation`              VARCHAR(30)   NOT NULL,
  `reason`                 TEXT          NULL,
  `correlation_id`         VARCHAR(64)   NOT NULL DEFAULT '',
  `idempotency_key`        VARCHAR(64)   NOT NULL,
  `created_at`             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `generated_document_edits_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_generated_document_edits_idem` UNIQUE(`organization_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_generated_document_edits_scope` ON `generated_document_edits` (`organization_id`,`process_id`,`kind`,`created_at`);
