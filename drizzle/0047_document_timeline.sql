-- Sprint 2: Operational timeline for documents (audit trail + observability)
CREATE TABLE `document_timeline` (
  `id`             int          AUTO_INCREMENT NOT NULL,
  `organizationId` int          NOT NULL,
  `documentId`     int          NOT NULL,
  `eventType`      varchar(100) NOT NULL,
  `actorId`        int          NOT NULL,
  `actorName`      varchar(255),
  `actorEmail`     varchar(320),
  `actorRole`      varchar(50),
  `versionId`      int,
  `fromState`      varchar(50),
  `toState`        varchar(50),
  `details`        json,
  `correlationId`  varchar(36),
  `requestId`      varchar(36),
  `occurredAt`     timestamp    NOT NULL DEFAULT (now()),
  CONSTRAINT `document_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_timeline_doc`     ON `document_timeline` (`documentId`, `occurredAt`);
--> statement-breakpoint
CREATE INDEX `idx_timeline_org`     ON `document_timeline` (`organizationId`);
--> statement-breakpoint
CREATE INDEX `idx_timeline_actor`   ON `document_timeline` (`actorId`);
