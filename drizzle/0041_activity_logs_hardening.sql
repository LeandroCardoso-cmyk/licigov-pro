-- Sprint 1.5 — ActivityLog hardening: snapshots imutáveis para rastreabilidade jurídica
-- Snapshots capturam o estado do ator/org NO MOMENTO da ação (sobrevivem a mutações futuras)

ALTER TABLE `activity_logs` ADD COLUMN `actorEmail`    varchar(320) AFTER `actorName`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `actorRole`     varchar(50)  AFTER `actorEmail`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `orgName`       varchar(255) AFTER `actorRole`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `sourceContext` enum('api','job','system','test','webhook') NOT NULL DEFAULT 'api' AFTER `orgName`;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `ipAddress`     varchar(45)  AFTER `sourceContext`;
--> statement-breakpoint
-- processId nullable: suporta logs org-level sem processo associado (ex: org.member_invited)
ALTER TABLE `activity_logs` MODIFY COLUMN `processId` int;