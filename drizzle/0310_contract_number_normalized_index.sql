-- 0310 — R3 / PR-06 (SEM-007): número oficial do contrato NORMALIZADO + índice de consulta (SEM política de unicidade).
--
-- REESTRUTURADA no 2º passe autônomo (2026-10-02). A versão anterior impunha UNIQUE(organization_id, normalized_number)
-- — "número único por órgão, qualquer que seja a origem" — como se fosse decisão do owner. A evidência disponível é um
-- registro (escrito pelo agente) de aprovação de um pacote proposto, e o owner não confirma esse escopo. É uma decisão
-- INSTITUCIONAL, não uma necessidade técnica do SEM-007: CONTRACT_NUMBER_SCOPE = BLOCKED_HUMAN_DECISION (HD-15).
-- A UNIQUE ficou PREPARADA fora da cadeia, em `drizzle/policy-pending/contract_number_scope_A_unique_per_org.sql`.
--
-- O SEM-007 (upsert por (origem, número) sobrescrevia contrato vigente) é resolvido SEM decidir o escopo: a chave natural
-- que JÁ existia é a PRIMARY KEY `id` = hash(org, origin_type, número normalizado); a criação passou a ser INSERT puro
-- (nunca upsert) e a colisão nessa PK ⇒ converge (mesmo payload em "minuta") ou CONFLICT. Concorrência: o INSERT na PK é
-- atômico — exatamente uma criação vence.
--
-- O que esta migration faz (puramente ADITIVA, sem dado reescrito, sem efeito de política):
--   1) `normalized_number` VARCHAR(80) utf8mb4_bin, coluna GERADA (STORED) = NULLIF(TRIM(contract_number), '').
--   2) índice NÃO único idx_ctw_org_normalized_number(organization_id, normalized_number): consulta da colisão do mesmo
--      número entre origens (observabilidade `create_contract_number_used_by_other_origin`) e pré-requisito barato de
--      qualquer das opções de HD-15.
-- REPLAY-SAFE: ADD COLUMN / ADD INDEX guardados por INFORMATION_SCHEMA (reaplicar = no-op).
-- ROLLBACK (manual, sem perda de dado — a coluna é derivada):
--   ALTER TABLE `contract_workspaces` DROP INDEX `idx_ctw_org_normalized_number`;
--   ALTER TABLE `contract_workspaces` DROP COLUMN `normalized_number`;
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0310_apply`
--> statement-breakpoint
CREATE PROCEDURE `_ctw0310_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND COLUMN_NAME = 'normalized_number') = 0 THEN
    ALTER TABLE `contract_workspaces` ADD COLUMN `normalized_number` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
      GENERATED ALWAYS AS (NULLIF(TRIM(`contract_number`), '')) STORED;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND INDEX_NAME = 'idx_ctw_org_normalized_number') = 0 THEN
    ALTER TABLE `contract_workspaces` ADD INDEX `idx_ctw_org_normalized_number` (`organization_id`, `normalized_number`);
  END IF;
END
--> statement-breakpoint
CALL `_ctw0310_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0310_apply`
