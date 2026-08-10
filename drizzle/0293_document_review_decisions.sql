-- 0293 — PR C.2B: aprovação version-aware e workflow institucional de documentos (migration ADITIVA).
--
-- Adiciona UM artefato NOVO (CREATE TABLE IF NOT EXISTS — idempotente, sem ALTER, sem backfill,
-- sem tocar dados existentes):
--
--   `document_review_decisions` — LEDGER IMUTÁVEL (append-only) de decisões institucionais de
--   revisão/aprovação documental, VERSION-AWARE. Cada decisão humana (submit_for_review | approve |
--   reject | request_changes) fixa a VERSÃO sob decisão (`documentId` = linha da versão no modelo
--   row-per-version; `documentVersion` = número da versão), o estado anterior/posterior, o ator
--   (revisor/aprovador), o autor, a justificativa (obrigatória em rejeição/devolução), o correlationId
--   e a chave de idempotência (tenant-aware). NUNCA é atualizado: a decisão vigente é a última linha.
--   Aprova-se uma VERSÃO, não o documento abstratamente.
--
-- Isolamento: toda leitura/escrita valida `organizationId` na aplicação (convenção do projeto; sem FK).
-- Replay-safe: UNIQUE (organizationId, idempotencyKey) — reexecução da mesma chave não cria 2ª linha.

CREATE TABLE IF NOT EXISTS `document_review_decisions` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `organizationId`  INT           NOT NULL,
  `processId`       INT           NULL,
  `documentId`      INT           NOT NULL,
  `documentVersion` INT           NOT NULL,
  `action`          VARCHAR(30)   NOT NULL,  -- submit_for_review|approve|reject|request_changes
  `fromState`       VARCHAR(20)   NOT NULL,
  `toState`         VARCHAR(20)   NOT NULL,
  `actorUserId`     INT           NOT NULL,
  `authorUserId`    INT           NULL,
  `justification`   TEXT          NULL,      -- obrigatória em reject/request_changes
  `correlationId`   VARCHAR(36)   NULL,
  `idempotencyKey`  VARCHAR(64)   NULL,
  `createdAt`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_docreview_decision_idem` (`organizationId`, `idempotencyKey`),
  INDEX `idx_docreview_decision_doc`     (`organizationId`, `documentId`),
  INDEX `idx_docreview_decision_process` (`organizationId`, `processId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
