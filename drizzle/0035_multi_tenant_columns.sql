-- Zero-Gap Migration: Fase A — Adicionar organizationId como nullable
-- Fase B (backfill) é feita no bootstrap via script idempotente
-- Fase C (NOT NULL) será em sprint futura após validação completa

ALTER TABLE `processes`        ADD COLUMN `organizationId` int;
ALTER TABLE `documents`        ADD COLUMN `organizationId` int;
ALTER TABLE `tasks`            ADD COLUMN `organizationId` int;
ALTER TABLE `contracts`        ADD COLUMN `organizationId` int;
ALTER TABLE `direct_contracts` ADD COLUMN `organizationId` int;
ALTER TABLE `legal_opinions`   ADD COLUMN `organizationId` int;
ALTER TABLE `comments`         ADD COLUMN `organizationId` int;
ALTER TABLE `activity_logs`    ADD COLUMN `organizationId` int;

-- Índices para queries multi-tenant (adicionados agora para não bloquear inserts futuros)
CREATE INDEX `idx_processes_org`        ON `processes`        (`organizationId`);
CREATE INDEX `idx_documents_org`        ON `documents`        (`organizationId`);
CREATE INDEX `idx_tasks_org`            ON `tasks`            (`organizationId`);
CREATE INDEX `idx_contracts_org`        ON `contracts`        (`organizationId`);
CREATE INDEX `idx_direct_contracts_org` ON `direct_contracts` (`organizationId`);
CREATE INDEX `idx_legal_opinions_org`   ON `legal_opinions`   (`organizationId`);
CREATE INDEX `idx_activity_logs_org`    ON `activity_logs`    (`organizationId`);
