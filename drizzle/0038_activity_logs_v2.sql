-- Extensão estruturada do activity_logs para suporte a correlationId, rastreabilidade e auditoria
ALTER TABLE `activity_logs` ADD COLUMN `correlationId` varchar(36) AFTER `organizationId`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `requestId`     varchar(36) AFTER `correlationId`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `actorName`     varchar(255) AFTER `requestId`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `entityType`    varchar(50) AFTER `actorName`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `entityId`      int AFTER `entityType`;
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_correlation` ON `activity_logs` (`correlationId`);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_user`        ON `activity_logs` (`userId`);
--> statement-breakpoint
CREATE INDEX `idx_activity_logs_entity`      ON `activity_logs` (`entityType`, `entityId`);