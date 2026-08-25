-- 0295 — C.4B.1: superfície oficial + PROMOÇÃO GOVERNADA (migration ADITIVA, idempotente).
--
-- Adiciona apenas artefatos NOVOS, sem DROP, sem DELETE, sem backfill especulativo, preservando
-- integralmente os dados existentes. Dois efeitos:
--
--   1. `generated_documents.author_user_id` (INT NULL) — autor do rascunho (quem gerou/originou o
--      conteúdo). Base para a SEGREGAÇÃO DE DEVERES na emissão oficial (revisor/emissor ≠ autor) e
--      para a auditoria. Nulável: rascunhos anteriores à migração ficam sem autor conhecido.
--
--   2. `official_document_promotions` — LEDGER IMUTÁVEL (append-only) das emissões oficiais
--      governadas do Processo Licitatório: a decisão humana de promover um rascunho a versão oficial
--      `emitido` em `official_documents`. NÃO reutiliza `document_review_decisions` (acoplado à tabela
--      legada `documents` / IDs int). Chaves canônicas string. Idempotente por (organization_id,
--      idempotency_key). NUNCA atualizado após inserido.
--
-- Padrão idêntico ao das 0288/0294: o migrator roda cada chunk como UMA query (mysql2 sem
-- multipleStatements) e o MySQL 8 não tem ADD COLUMN condicional, então a idempotência do ALTER é
-- feita com SQL dinâmico via INFORMATION_SCHEMA (PREPARE/EXECUTE/DEALLOCATE). O CREATE TABLE usa
-- IF NOT EXISTS. Isolamento multi-tenant validado na aplicação (convenção do projeto; sem FK).

-- ── generated_documents.author_user_id INT NULL (aditivo idempotente) ──────────────────────────────
SET @sql_0295_author := (SELECT CASE
    WHEN COUNT(*) = 0
      THEN 'SELECT 1 FROM `erro_0295_generated_documents_ausente`'
    WHEN SUM(COLUMN_NAME = 'author_user_id') >= 1
      THEN 'SELECT 1'
    ELSE 'ALTER TABLE `generated_documents` ADD COLUMN `author_user_id` int NULL AFTER `legal_justification`'
  END
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'generated_documents');
--> statement-breakpoint
PREPARE stmt_0295_author FROM @sql_0295_author;
--> statement-breakpoint
EXECUTE stmt_0295_author;
--> statement-breakpoint
DEALLOCATE PREPARE stmt_0295_author;
--> statement-breakpoint
-- ── official_document_promotions — ledger imutável de emissão oficial governada ────────────────────
CREATE TABLE IF NOT EXISTS `official_document_promotions` (
  `id`                   INT           NOT NULL AUTO_INCREMENT,
  `organization_id`      INT           NOT NULL,
  `process_id`           VARCHAR(20)   NOT NULL,
  `official_document_id` VARCHAR(20)   NOT NULL,
  `lineage_id`           VARCHAR(20)   NOT NULL,
  `document_kind`        VARCHAR(20)   NOT NULL,
  `version`              INT           NOT NULL,
  `content_hash`         VARCHAR(64)   NOT NULL,
  `actor_user_id`        INT           NOT NULL,
  `author_user_id`       INT           NULL,
  `previous_status`      VARCHAR(20)   NOT NULL DEFAULT '',
  `next_status`          VARCHAR(20)   NOT NULL DEFAULT 'emitido',
  `reason`               TEXT          NULL,
  `correlation_id`       VARCHAR(64)   NOT NULL DEFAULT '',
  `idempotency_key`      VARCHAR(64)   NOT NULL,
  `created_at`           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `official_document_promotions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_official_promotion_idem` UNIQUE(`organization_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_official_promotion_lineage` ON `official_document_promotions` (`organization_id`,`lineage_id`);
--> statement-breakpoint
CREATE INDEX `idx_official_promotion_process_kind` ON `official_document_promotions` (`organization_id`,`process_id`,`document_kind`);
