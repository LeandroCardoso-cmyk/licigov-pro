-- Extensão estruturada do activity_logs para suporte a correlationId, rastreabilidade e auditoria
ALTER TABLE `activity_logs` ADD COLUMN `correlationId` varchar(36) AFTER `organizationId`;
ALTER TABLE `activity_logs` ADD COLUMN `requestId`     varchar(36) AFTER `correlationId`;
ALTER TABLE `activity_logs` ADD COLUMN `actorName`     varchar(255) AFTER `requestId`;
ALTER TABLE `activity_logs` ADD COLUMN `entityType`    varchar(50) AFTER `actorName`;
ALTER TABLE `activity_logs` ADD COLUMN `entityId`      int AFTER `entityType`;

CREATE INDEX `idx_activity_logs_correlation` ON `activity_logs` (`correlationId`);
CREATE INDEX `idx_activity_logs_user`        ON `activity_logs` (`userId`);
CREATE INDEX `idx_activity_logs_entity`      ON `activity_logs` (`entityType`, `entityId`);
