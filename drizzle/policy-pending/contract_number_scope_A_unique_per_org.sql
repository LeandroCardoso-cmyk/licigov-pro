-- CONTRACT_NUMBER_SCOPE — OPÇÃO A (PENDENTE DE DECISÃO HUMANA, HD-15). FORA da cadeia de migrations (não está no
-- journal; NÃO é aplicada por `db:migrate`). Só vira migration numerada (próximo número livre) se o owner escolher A.
--
-- Opção A: o número oficial do contrato é ÚNICO POR ÓRGÃO, qualquer que seja a origem (processo licitatório,
-- contratação direta, avulso, importado). Requer a 0310 (coluna gerada `normalized_number`).
-- FAIL-CLOSED: antes do DDL conta grupos (órgão, número normalizado) com 2+ contratos e aborta com
-- SIGNAL 'CNS_A_FC_DUP_CONTRACT_NUMBER_PER_ORG' sem tocar em nada. Preflight read-only: preflight_contract_number_scope_A.sql.
-- Testada localmente por `contract-number-scope-policy-pending-mysql-smoke` (aplicada só em banco descartável).
-- Opção B (único por órgão + origem) não precisa de SQL: é a PRIMARY KEY hash(org, origem, número) que já existe.
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctwA_guard`
--> statement-breakpoint
CREATE PROCEDURE `_ctwA_guard`()
BEGIN
  DECLARE n INT;
  -- Mesma expressão e mesma colação do índice: o guard e o UNIQUE concordam exatamente.
  SELECT COUNT(*) INTO n FROM (
    SELECT `organization_id`, NULLIF(TRIM(`contract_number`), '') COLLATE utf8mb4_bin AS k
      FROM `contract_workspaces`
     WHERE NULLIF(TRIM(`contract_number`), '') IS NOT NULL
     GROUP BY `organization_id`, k
    HAVING COUNT(*) > 1
  ) d;
  -- MESSAGE_TEXT curto/estável (MySQL 8.4 limita a 128 chars); a explicação humana fica no cabeçalho.
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CNS_A_FC_DUP_CONTRACT_NUMBER_PER_ORG';
  END IF;
END
--> statement-breakpoint
CALL `_ctwA_guard`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctwA_guard`
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctwA_apply`
--> statement-breakpoint
CREATE PROCEDURE `_ctwA_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND INDEX_NAME = 'uq_ctw_org_normalized_number') = 0 THEN
    ALTER TABLE `contract_workspaces` ADD CONSTRAINT `uq_ctw_org_normalized_number` UNIQUE (`organization_id`, `normalized_number`);
  END IF;
END
--> statement-breakpoint
CALL `_ctwA_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctwA_apply`
