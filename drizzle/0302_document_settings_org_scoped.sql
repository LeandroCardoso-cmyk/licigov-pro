-- 0302 — documentSettings: identidade institucional TENANT-SCOPED, SEM DUPLICIDADE, FAIL-CLOSED.
--
-- Corrige dois defeitos de governança de uma vez, de forma DETERMINÍSTICA e à prova de ambiguidade:
--   (H1) a identidade era per-usuário (`userId`) — consolida em 1 linha por organização (`organizationId`);
--   (H2) `organizationName`/`cnpj` eram DUPLICADOS aqui e em `organizations` — passam a viver SÓ em
--        `organizations` (fonte canônica), e `documentSettings` fica como EXTENSÃO documental (logo,
--        endereço, contato, rodapé).
--
-- PRINCÍPIO: determinismo técnico não basta — a migração NÃO pode escolher arbitrariamente nem
-- descartar identidade em silêncio. TODAS as precondições são verificadas ANTES de qualquer mutação;
-- em caso de ambiguidade a migração ABORTA (SIGNAL) sem tocar em dados. Em clean install (tabela vazia)
-- todos os guards têm contagem 0 e o esquema converge igual.
--
-- FAIL-CLOSED (aborta antes de mutar) quando:
--   A) usuário com documentSettings e ZERO organizações ativas (órfão) — sem tenant a que pertencer;
--   B) usuário com documentSettings e MAIS DE UMA organização ativa — destino do tenant ambíguo;
--   C) 2+ documentSettings destinados ao MESMO tenant com identidade DIFERENTE — consolidação ambígua
--      (dedupe automático só é permitido entre linhas semanticamente IDÊNTICAS);
--   D) `documentSettings.organizationName` não-vazio DIVERGE de `organizations.nome` (fonte canônica);
--   E) `documentSettings.cnpj` não-vazio DIVERGE de `organizations.cnpj` (quando o canônico já existe).
-- PRESERVAÇÃO (sem discard): quando `organizations.cnpj` é NULO e o documentSettings tem CNPJ, o valor
-- é PROMOVIDO para a fonte canônica (F) antes de a coluna duplicada ser removida.

-- ── GUARD (fail-closed) — roda ANTES de qualquer DDL/DML de mutação ─────────────────────────────
DROP PROCEDURE IF EXISTS `_ds0302_guard`
--> statement-breakpoint
CREATE PROCEDURE `_ds0302_guard`()
BEGIN
  DECLARE n INT;

  -- A) órfão: documentSettings de usuário SEM organização ativa
  SELECT COUNT(*) INTO n FROM `documentSettings` ds
   WHERE NOT EXISTS (SELECT 1 FROM `organization_members` m WHERE m.`userId` = ds.`userId` AND m.`ativo` = 1);
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0302 FAIL-CLOSED (A): documentSettings de usuario sem organizacao ativa (orfao). Resolva manualmente antes de migrar.';
  END IF;

  -- B) multi-org: documentSettings de usuário com MAIS DE UMA organização ativa
  SELECT COUNT(*) INTO n FROM `documentSettings` ds
   WHERE (SELECT COUNT(*) FROM `organization_members` m WHERE m.`userId` = ds.`userId` AND m.`ativo` = 1) > 1;
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0302 FAIL-CLOSED (B): documentSettings de usuario com multiplas organizacoes ativas — destino do tenant ambiguo. Resolva manualmente.';
  END IF;

  -- C) conflito de tenant: 2+ documentSettings para o MESMO tenant com identidade DIFERENTE
  --    (destino = organização ativa única do usuário, garantida por A+B)
  SELECT COUNT(*) INTO n FROM (
    SELECT m.`organizationId` AS orgId
      FROM `documentSettings` ds
      JOIN `organization_members` m ON m.`userId` = ds.`userId` AND m.`ativo` = 1
     GROUP BY m.`organizationId`
    HAVING COUNT(DISTINCT CONCAT_WS('\n',
             COALESCE(TRIM(ds.`organizationName`),''),
             COALESCE(TRIM(ds.`logoUrl`),''),
             COALESCE(TRIM(ds.`address`),''),
             COALESCE(REPLACE(REPLACE(REPLACE(TRIM(ds.`cnpj`),'.',''),'/',''),'-',''),''),
             COALESCE(TRIM(ds.`phone`),''),
             COALESCE(TRIM(ds.`email`),''),
             COALESCE(TRIM(ds.`website`),''),
             COALESCE(TRIM(ds.`footerText`),''))) > 1
  ) t;
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0302 FAIL-CLOSED (C): multiplas configuracoes institucionais DIVERGENTES destinadas ao mesmo tenant. Consolide manualmente antes de migrar.';
  END IF;

  -- D) conflito de nome: organizationName não-vazio DIFERENTE de organizations.nome (canônico)
  SELECT COUNT(*) INTO n FROM `documentSettings` ds
    JOIN `organization_members` m ON m.`userId` = ds.`userId` AND m.`ativo` = 1
    JOIN `organizations` o ON o.`id` = m.`organizationId`
   WHERE TRIM(COALESCE(ds.`organizationName`,'')) <> ''
     AND LOWER(TRIM(ds.`organizationName`)) <> LOWER(TRIM(o.`nome`));
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0302 FAIL-CLOSED (D): organizationName em documentSettings diverge de organizations.nome (fonte canonica). Reconcilie antes de migrar.';
  END IF;

  -- E) conflito de CNPJ: cnpj não-vazio DIFERENTE de organizations.cnpj (quando o canônico já existe)
  SELECT COUNT(*) INTO n FROM `documentSettings` ds
    JOIN `organization_members` m ON m.`userId` = ds.`userId` AND m.`ativo` = 1
    JOIN `organizations` o ON o.`id` = m.`organizationId`
   WHERE TRIM(COALESCE(ds.`cnpj`,'')) <> ''
     AND o.`cnpj` IS NOT NULL
     AND REPLACE(REPLACE(REPLACE(TRIM(ds.`cnpj`),'.',''),'/',''),'-','') <> REPLACE(REPLACE(REPLACE(TRIM(o.`cnpj`),'.',''),'/',''),'-','');
  IF n > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '0302 FAIL-CLOSED (E): cnpj em documentSettings diverge de organizations.cnpj (fonte canonica). Reconcilie antes de migrar.';
  END IF;
END
--> statement-breakpoint
CALL `_ds0302_guard`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_ds0302_guard`
--> statement-breakpoint

-- F) PRESERVAÇÃO (sem discard): promove o CNPJ do documentSettings para o canônico quando ausente lá.
UPDATE `organizations` o
  JOIN `organization_members` m ON m.`organizationId` = o.`id` AND m.`ativo` = 1
  JOIN `documentSettings` ds ON ds.`userId` = m.`userId`
   SET o.`cnpj` = TRIM(ds.`cnpj`)
 WHERE o.`cnpj` IS NULL AND TRIM(COALESCE(ds.`cnpj`,'')) <> '';
--> statement-breakpoint

-- 1) coluna nova, nullable para o backfill determinístico
ALTER TABLE `documentSettings` ADD `organizationId` int NULL;
--> statement-breakpoint

-- 2) backfill: userId → organização ativa ÚNICA do usuário (garantida por A+B)
UPDATE `documentSettings` ds
  JOIN `organization_members` m ON m.`userId` = ds.`userId` AND m.`ativo` = 1
   SET ds.`organizationId` = m.`organizationId`
 WHERE ds.`organizationId` IS NULL;
--> statement-breakpoint

-- 3) dedupe determinístico entre linhas SEMANTICAMENTE IDÊNTICAS do mesmo tenant (guard C garante
--    equivalência — nenhum dado divergente é descartado). Mantém a de maior id.
DELETE ds FROM `documentSettings` ds
  JOIN `documentSettings` other
    ON other.`organizationId` = ds.`organizationId` AND other.`id` > ds.`id`
 WHERE ds.`organizationId` IS NOT NULL;
--> statement-breakpoint

-- 4) enforce NOT NULL (não há órfãos — guard A abortaria)
ALTER TABLE `documentSettings` MODIFY `organizationId` int NOT NULL;
--> statement-breakpoint

-- 5) unicidade por organização: 1 identidade documental por tenant (determinismo/replay)
ALTER TABLE `documentSettings` ADD CONSTRAINT `documentSettings_org_unique` UNIQUE(`organizationId`);
--> statement-breakpoint

-- 6) remove a chave per-usuário legada
ALTER TABLE `documentSettings` DROP COLUMN `userId`;
--> statement-breakpoint

-- 7) elimina a DUPLICIDADE canônica: nome/cnpj passam a viver SÓ em `organizations`
ALTER TABLE `documentSettings` DROP COLUMN `organizationName`;
--> statement-breakpoint
ALTER TABLE `documentSettings` DROP COLUMN `cnpj`;
