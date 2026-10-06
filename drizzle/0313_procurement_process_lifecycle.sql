-- 0313 — Pilot Reset B2/B3: lifecycle governado do Processo Licitatório (identidade de geração + ledger append-only).
--
-- Contrato: server/domain/processLifecycle.ts e docs/architecture/PILOT_RESET_GOVERNED_LIFECYCLE.md.
--
-- O que muda (puramente ADITIVO — nenhum DROP, nenhum DELETE, nenhuma linha existente reescrita):
--  1) procurement_processes ganha:
--     - lineage_id (opaco, NULL = geração única ainda não materializada — TODAS as linhas existentes),
--       generation_no (DEFAULT 1), lifecycle_state (DEFAULT 'active'), lifecycle_revision (DEFAULT 0),
--       supersedes_process_id (NULL);
--     - colunas GERADAS (STORED): active_lineage_key = lineage_id só quando active; active_number_key =
--       process_number (não vazio) só quando active, em colação BINÁRIA (exata, como a PK determinística);
--     - UNIQUE(organization_id, active_lineage_key): no máximo UMA geração ativa por linhagem;
--     - UNIQUE(organization_id, active_number_key): no máximo UM processo ATIVO por número no órgão (depois de uma
--       correção de número a PK derivada do número antigo deixa de proteger o número novo — o banco protege);
--     - índice (organization_id, lineage_id).
--     O "backfill" é só o DEFAULT das colunas novas (active / revisão 0 / geração 1): nada é inferido nem inventado.
--  2) procurement_process_lifecycle_events: ledger append-only (antes/depois, motivo, ator, digest de elegibilidade,
--     revisões, idempotência por (órgão, chave, tipo de evento)).
--
-- FAIL-CLOSED (padrão 0302/0310): ANTES de qualquer DDL, o guard conta números ATIVOS duplicados por órgão
-- (comparação binária, número não vazio). Pela PK determinística sha256(org:número) isso não deveria existir; se
-- existir, ABORTA com SIGNAL '0313_FC_DUP_ACTIVE_PROCESS_NUMBER' sem tocar em nada (remediação = decisão humana).
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS; ADD COLUMN / ADD UNIQUE / ADD INDEX guardados por INFORMATION_SCHEMA.
-- Adicionar coluna STORED reconstrói procurement_processes (ALGORITHM=COPY); a tabela é pequena.
-- ROLLBACK lógico: as colunas são aditivas e com DEFAULT; o build anterior as ignora (não as escreve). Remover exigiria
-- DROP manual (não incluído) e só é seguro se nenhum lifecycle tiver sido executado.
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_pp0313_guard`
--> statement-breakpoint
CREATE PROCEDURE `_pp0313_guard`()
guard: BEGIN
  DECLARE n INT;
  -- Já migrado (reaplicação manual): a unicidade passou a ser só entre gerações ATIVAS e é garantida pelos UNIQUE
  -- gerados; gerações históricas podem legitimamente repetir o número. Nada a verificar.
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND COLUMN_NAME = 'lifecycle_state') > 0 THEN
    LEAVE guard;
  END IF;
  SELECT COUNT(*) INTO n FROM (
    SELECT `organization_id`, CAST(`process_number` AS BINARY) AS k
      FROM `procurement_processes`
     WHERE `process_number` <> ''
     GROUP BY `organization_id`, k
    HAVING COUNT(*) > 1
  ) d;
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0313_FC_DUP_ACTIVE_PROCESS_NUMBER';
  END IF;
END
--> statement-breakpoint
CALL `_pp0313_guard`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_pp0313_guard`
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_process_lifecycle_events` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`lineage_id` varchar(24) NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`action` varchar(32) NOT NULL,
	`event_type` varchar(32) NOT NULL,
	`from_state` varchar(20) NOT NULL,
	`to_state` varchar(20) NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text NOT NULL,
	`actor_user_id` int NOT NULL,
	`eligibility_digest` varchar(64) NOT NULL,
	`revision_before` int NOT NULL,
	`revision_after` int NOT NULL,
	`idempotency_key` varchar(128) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`result_json` text,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_process_lifecycle_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pple_org_idem_event` UNIQUE(`organization_id`,`idempotency_key`,`event_type`),
	INDEX `idx_pple_lineage` (`organization_id`,`lineage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_pp0313_apply`
--> statement-breakpoint
CREATE PROCEDURE `_pp0313_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND COLUMN_NAME = 'lineage_id') = 0 THEN
    ALTER TABLE `procurement_processes`
      ADD COLUMN `lineage_id` varchar(24) NULL,
      ADD COLUMN `generation_no` int NOT NULL DEFAULT 1,
      ADD COLUMN `lifecycle_state` varchar(20) NOT NULL DEFAULT 'active',
      ADD COLUMN `lifecycle_revision` int NOT NULL DEFAULT 0,
      ADD COLUMN `supersedes_process_id` varchar(20) NULL;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND COLUMN_NAME = 'active_lineage_key') = 0 THEN
    ALTER TABLE `procurement_processes`
      ADD COLUMN `active_lineage_key` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (if((`lifecycle_state` = 'active'),`lineage_id`,NULL)) STORED,
      ADD COLUMN `active_number_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (if((`lifecycle_state` = 'active'),nullif(`process_number`,''),NULL)) STORED;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND INDEX_NAME = 'uq_pp_active_lineage') = 0 THEN
    ALTER TABLE `procurement_processes` ADD CONSTRAINT `uq_pp_active_lineage` UNIQUE (`organization_id`, `active_lineage_key`);
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND INDEX_NAME = 'uq_pp_active_number') = 0 THEN
    ALTER TABLE `procurement_processes` ADD CONSTRAINT `uq_pp_active_number` UNIQUE (`organization_id`, `active_number_key`);
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_processes' AND INDEX_NAME = 'idx_pp_lineage') = 0 THEN
    CREATE INDEX `idx_pp_lineage` ON `procurement_processes` (`organization_id`, `lineage_id`);
  END IF;
END
--> statement-breakpoint
CALL `_pp0313_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_pp0313_apply`
