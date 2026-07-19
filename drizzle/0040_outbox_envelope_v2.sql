-- Sprint 1.5 — Outbox Envelope v2: propagação de actor + tenant context
-- Permite rastrear quem disparou o evento e em qual org, em toda a cadeia async

ALTER TABLE `outbox_events` ADD COLUMN `actorId`       int          AFTER `requestId`;
--> statement-breakpoint
ALTER TABLE `outbox_events` ADD COLUMN `actorName`     varchar(255) AFTER `actorId`;
--> statement-breakpoint
ALTER TABLE `outbox_events` ADD COLUMN `tenantContext` json         AFTER `actorName`;