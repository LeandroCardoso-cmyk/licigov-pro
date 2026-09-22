-- 0302 — documentSettings: per-user → per-org (identidade institucional documental TENANT-SCOPED).
-- Migração DETERMINÍSTICA e SEGURA para dados existentes. Corrige o defeito de governança em que a
-- identidade institucional que aparece nos documentos era configuração pessoal por usuário (userId),
-- consolidando-a em uma única linha por organização (organizationId único). Ordem: adiciona a coluna
-- nullable → backfill via organization_members → deduplica por organização → descarta órfãos → só
-- então NOT NULL + UNIQUE e remove a chave per-user. Em clean install (tabela vazia) todos os passos
-- de dados são no-op e o esquema converge igual.

-- 1) coluna nova, nullable para permitir o backfill determinístico
ALTER TABLE `documentSettings` ADD `organizationId` int NULL;--> statement-breakpoint

-- 2) backfill: mapeia userId → organização ATIVA de MENOR id (determinístico e estável)
UPDATE `documentSettings` ds
JOIN (
  SELECT `userId`, MIN(`organizationId`) AS orgId
  FROM `organization_members`
  WHERE `ativo` = 1
  GROUP BY `userId`
) m ON m.`userId` = ds.`userId`
SET ds.`organizationId` = m.orgId
WHERE ds.`organizationId` IS NULL;--> statement-breakpoint

-- 3) dedupe: mantém 1 linha por organização (maior updatedAt; empate por maior id) — determinístico
DELETE ds FROM `documentSettings` ds
JOIN `documentSettings` other
  ON other.`organizationId` = ds.`organizationId`
 AND (other.`updatedAt` > ds.`updatedAt`
      OR (other.`updatedAt` = ds.`updatedAt` AND other.`id` > ds.`id`))
WHERE ds.`organizationId` IS NOT NULL;--> statement-breakpoint

-- 4) descarta órfãos: linhas de usuários sem organização ativa não têm tenant a que pertencer
DELETE FROM `documentSettings` WHERE `organizationId` IS NULL;--> statement-breakpoint

-- 5) enforce NOT NULL após o backfill
ALTER TABLE `documentSettings` MODIFY `organizationId` int NOT NULL;--> statement-breakpoint

-- 6) unicidade por organização: 1 identidade institucional por tenant (determinismo/replay)
ALTER TABLE `documentSettings` ADD CONSTRAINT `documentSettings_org_unique` UNIQUE(`organizationId`);--> statement-breakpoint

-- 7) remove a chave per-user legada
ALTER TABLE `documentSettings` DROP COLUMN `userId`;
