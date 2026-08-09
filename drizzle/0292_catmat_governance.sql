-- 0292 — PR C.2: governança operacional de CATMAT/CATSER (migration ADITIVA).
--
-- Adiciona dois artefatos NOVOS (CREATE TABLE IF NOT EXISTS — idempotente, sem ALTER,
-- sem backfill, sem tocar dados existentes):
--
--   1) `catmat_decisions` — LEDGER IMUTÁVEL (append-only) de decisões humanas sobre
--      sugestões CATMAT/CATSER: confirmado | rejeitado | substituido |
--      sem_correspondencia_segura. Registra ator, processo, item, sugestão, código,
--      proveniência, score, justificativa (obrigatória em rejeição/substituição/
--      sem-correspondência), o limiar em vigor no momento, correlationId e a chave de
--      idempotência (tenant-aware). NUNCA é atualizado: a decisão vigente é a última
--      linha do item. O código CATMAT nunca é fabricado (vem de sugestão do domínio ou
--      de entrada humana explícita).
--
--   2) `catmat_threshold_config` — CONFIGURAÇÃO INSTITUCIONAL VERSIONADA do limiar de
--      confiança (fail-closed). Tenant-aware, com ator, vigência, versão e lineage.
--      NENHUM valor é semeado por esta migration: sem linha ativa, o domínio permanece
--      fail-closed (`threshold_not_configured`). O VALOR é decisão institucional humana
--      (definido em runtime por um papel autorizado), nunca escolhido pelo código.
--
-- Isolamento: toda leitura/escrita valida `organizationId` na aplicação (convenção do
-- projeto; sem FK). Replay-safe: UNIQUE (org, idempotencyKey) no ledger.

CREATE TABLE IF NOT EXISTS `catmat_decisions` (
  `id`                INT           NOT NULL AUTO_INCREMENT,
  `organizationId`    INT           NOT NULL,
  `processId`         VARCHAR(20),
  `itemId`            VARCHAR(20)   NOT NULL,
  `decision`          VARCHAR(30)   NOT NULL,  -- confirmado|rejeitado|substituido|sem_correspondencia_segura
  `suggestionId`      VARCHAR(20),             -- id do CATMATMatch decidido (null p/ manual/none)
  `catmatCode`        VARCHAR(50),             -- código confirmado/substituído (null p/ rejeição/none)
  `catmatDescription` TEXT,
  `source`            VARCHAR(40),             -- proveniência da sugestão
  `score`             DECIMAL(6,5),            -- confiança da sugestão decidida (null quando N/A)
  `justification`     TEXT,                    -- obrigatória em rejeição/substituição/sem-correspondência
  `thresholdMinScore` DECIMAL(6,5),            -- limiar em vigor no momento da decisão (null se não configurado)
  `thresholdConfigId` INT,                     -- versão do limiar em vigor
  `actorUserId`       INT           NOT NULL,
  `correlationId`     VARCHAR(36),
  `idempotencyKey`    VARCHAR(64),
  `createdAt`         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catmat_decision_idem` (`organizationId`, `idempotencyKey`),
  INDEX `idx_catmat_decision_item`     (`organizationId`, `itemId`),
  INDEX `idx_catmat_decision_process`  (`organizationId`, `processId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
-- Configuração VERSIONADA do limiar (sem valor semeado — fail-closed até definição institucional).
CREATE TABLE IF NOT EXISTS `catmat_threshold_config` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `organizationId` INT           NOT NULL,
  `minScore`       DECIMAL(6,5)  NOT NULL,   -- VALOR institucional (definido por humano autorizado; nunca pelo código)
  `version`        INT           NOT NULL DEFAULT 1,
  `active`         TINYINT       NOT NULL DEFAULT 1,
  `reason`         VARCHAR(500),
  `actorUserId`    INT           NOT NULL,
  `correlationId`  VARCHAR(36),
  `effectiveFrom`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt`      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_catmat_threshold_active` (`organizationId`, `active`, `version`),
  INDEX `idx_catmat_threshold_org`       (`organizationId`, `active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
