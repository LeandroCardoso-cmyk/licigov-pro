CREATE TABLE `outbox_events` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `organizationId` int,
  `eventType` varchar(100) NOT NULL,
  `aggregateType` varchar(50) NOT NULL,
  `aggregateId` varchar(50) NOT NULL,
  `correlationId` varchar(36),
  `requestId` varchar(36),
  `payload` json NOT NULL,
  `status` enum('pending','processing','delivered','failed') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `lastError` text,
  `lockedBy` varchar(100),
  `lockedUntil` timestamp NULL,
  `scheduledAfter` timestamp NULL,
  `processedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  INDEX `idx_outbox_status_scheduled` (`status`, `scheduledAfter`),
  INDEX `idx_outbox_org` (`organizationId`),
  INDEX `idx_outbox_aggregate` (`aggregateType`, `aggregateId`)
);
--> statement-breakpoint
CREATE TABLE `outbox_dead_letters` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `organizationId` int,
  `eventType` varchar(100) NOT NULL,
  `aggregateType` varchar(50) NOT NULL,
  `aggregateId` varchar(50) NOT NULL,
  `correlationId` varchar(36),
  `payload` json NOT NULL,
  `attempts` int NOT NULL,
  `lastError` text,
  `movedAt` timestamp NOT NULL DEFAULT now(),
  `resolution` enum('pending','resolved','discarded') NOT NULL DEFAULT 'pending',
  `resolvedBy` int,
  `resolvedAt` timestamp NULL,
  `resolvedNote` text,
  INDEX `idx_dlq_org` (`organizationId`),
  INDEX `idx_dlq_resolution` (`resolution`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `organizationId` int NOT NULL,
  `userId` int NOT NULL,
  `key` varchar(255) NOT NULL,
  `operation` varchar(100) NOT NULL,
  `status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
  `requestPayloadHash` varchar(64),
  `responsePayload` json,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  `expiresAt` timestamp NOT NULL,
  UNIQUE KEY `idempotency_org_user_key` (`organizationId`, `userId`, `key`),
  INDEX `idx_idempotency_expires` (`expiresAt`)
);