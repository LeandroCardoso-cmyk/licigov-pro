-- Zero-Gap Migration: Fase A — Adicionar organizationId como nullable
-- Fase B (backfill) é feita no bootstrap via script idempotente
-- Fase C (NOT NULL) será em sprint futura após validação completa

ALTER TABLE `processes`        ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `documents`        ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `tasks`            ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `contracts`        ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `direct_contracts` ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `legal_opinions`   ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `comments`         ADD COLUMN `organizationId` int;
--> statement-breakpoint
ALTER TABLE `activity_logs`    ADD COLUMN `organizationId` int;
--> statement-breakpoint
-- Índices para queries multi-tenant (adicionados agora para não bloquear inserts futuros)
CREATE INDEX `idx_processes_org`        ON `processes`        (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_documents_org`        ON `documents`        (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_tasks_org`            ON `tasks`            (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_contracts_org`        ON `contracts`        (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_direct_contracts_org` ON `direct_contracts` (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_legal_opinions_org`   ON `legal_opinions`   (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_org`    ON `activity_logs`    (`organizationId`);