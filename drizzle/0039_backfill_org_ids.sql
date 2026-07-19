-- Sprint 1.5 — Phase B: Backfill organizationId → org padrão (id=1)
-- Idempotente: WHERE organizationId IS NULL (safe to re-run)
-- Registros legados criados antes do multi-tenant recebem org=1 como âncora

UPDATE `processes`        SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `documents`        SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `tasks`            SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `contracts`        SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `direct_contracts` SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `legal_opinions`   SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `comments`         SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
UPDATE `activity_logs`    SET `organizationId` = 1 WHERE `organizationId` IS NULL;
--> statement-breakpoint
-- Índice faltante da migração 0035 (comments não recebeu idx_org)
CREATE INDEX `idx_comments_org` ON `comments` (`organizationId`);