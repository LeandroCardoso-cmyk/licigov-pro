-- 0308 — R3 / PR-06 (decisão do responsável B): o NÚMERO OFICIAL do contrato é ÚNICO POR ORGANIZAÇÃO, qualquer que
-- seja a origem (processo licitatório, contratação direta, avulso/manual, importado).
--
-- Antes: a única chave de `contract_workspaces` era a PRIMARY KEY `id` = hash(org, origin_type, contract_number) — a
-- ORIGEM fazia parte da chave, então o mesmo número podia nascer uma vez por origem na mesma organização.
--
-- O que esta migration faz (puramente ADITIVA — nenhum DROP, nenhum UPDATE/DELETE, nenhum dado reescrito):
--   1) `normalized_number` VARCHAR(80) utf8mb4_bin, coluna GERADA (STORED) = NULLIF(TRIM(contract_number), '').
--      Normalização DETERMINÍSTICA e MÍNIMA: só remove espaços das pontas. Não muda caixa, não remove zeros, não
--      reinterpreta ano/separadores. Colação BINÁRIA: a comparação é exata após o trim (a colação da tabela,
--      utf8mb4_unicode_ci, igualaria caixa/acentos — regra que NÃO foi decidida). Número vazio ⇒ NULL (não colide).
--      O "backfill" é a própria geração pelo banco (trim) — nenhum valor inventado; a coluna acompanha
--      `contract_number` em QUALQUER escrita futura (criação, edição, upsert legado), sem código de aplicação.
--   2) UNIQUE(organization_id, normalized_number) — a garantia no BANCO (inclusive contra corrida entre origens).
--
-- FAIL-CLOSED (padrão 0302): ANTES de qualquer DDL, o guard conta grupos (organization_id, número normalizado) com
-- 2+ contratos. Havendo QUALQUER duplicata, ABORTA com SIGNAL '0308_FC_DUP_CONTRACT_NUMBER_PER_ORG' sem tocar em nada
-- (nenhum dedupe, nenhuma escolha arbitrária de qual contrato "vale"): remediação é decisão HUMANA — rodar o preflight
-- read-only (docs no relatório da PR-06) e corrigir os números na origem antes de migrar.
--
-- REPLAY-SAFE: ADD COLUMN / ADD UNIQUE guardados por INFORMATION_SCHEMA (reaplicar = no-op). MySQL 8.4 e MariaDB.
-- Adicionar coluna STORED reconstrói a tabela (ALGORITHM=COPY) — `contract_workspaces` é pequena.
-- ROLLBACK (manual, sem perda de dado — a coluna é derivada):
--   ALTER TABLE `contract_workspaces` DROP INDEX `uq_ctw_org_normalized_number`;
--   ALTER TABLE `contract_workspaces` DROP COLUMN `normalized_number`;
--   DELETE FROM `__drizzle_migrations` WHERE hash = '<hash da 0308>';  -- só se o build anterior for reimplantado
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0308_guard`
--> statement-breakpoint
CREATE PROCEDURE `_ctw0308_guard`()
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
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0308_FC_DUP_CONTRACT_NUMBER_PER_ORG';
  END IF;
END
--> statement-breakpoint
CALL `_ctw0308_guard`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0308_guard`
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0308_apply`
--> statement-breakpoint
CREATE PROCEDURE `_ctw0308_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND COLUMN_NAME = 'normalized_number') = 0 THEN
    ALTER TABLE `contract_workspaces` ADD COLUMN `normalized_number` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
      GENERATED ALWAYS AS (NULLIF(TRIM(`contract_number`), '')) STORED;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contract_workspaces' AND INDEX_NAME = 'uq_ctw_org_normalized_number') = 0 THEN
    ALTER TABLE `contract_workspaces` ADD CONSTRAINT `uq_ctw_org_normalized_number` UNIQUE (`organization_id`, `normalized_number`);
  END IF;
END
--> statement-breakpoint
CALL `_ctw0308_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ctw0308_apply`
