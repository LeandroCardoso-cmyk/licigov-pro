-- 0285 — Reconciliação de schema (produção criada por db:push antigo × cadeia de migrations).
-- A auditoria (scripts/schema-audit.ts) apontou 17 tabelas presentes no Drizzle e AUSENTES no banco:
-- o journal (__drizzle_migrations) marca as migrations antigas como aplicadas, então o migrate() do
-- boot nunca as recria. Esta migration é NOVA (idx 285) e por isso roda em qualquer ambiente,
-- criando apenas o que falta — IF NOT EXISTS a torna idempotente e segura onde as tabelas já existem
-- (staging/CI). DDL extraído do schema.ts atual via drizzle-kit (forma FINAL das tabelas).
-- Puramente aditiva: não altera nem remove nada existente. Colunas ausentes em tabelas existentes
-- são tratadas no ensureSchema (server/bootstrap.ts), que já é o padrão idempotente do projeto.
CREATE TABLE IF NOT EXISTS `document_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`documentId` int NOT NULL,
	`versionId` int,
	`filename` varchar(255) NOT NULL,
	`originalFilename` varchar(255) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileSize` int NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`contentHash` varchar(64),
	`scanStatus` enum('pending','clean','infected','error') NOT NULL DEFAULT 'pending',
	`uploadedBy` int NOT NULL,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_attachments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`documentId` int NOT NULL,
	`userId` int NOT NULL,
	`contentDraft` text,
	`structuredDraft` json,
	`baseVersionId` int,
	`version` int NOT NULL DEFAULT 1,
	`lastSavedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`correlationId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `document_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_render_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`documentId` int NOT NULL,
	`versionId` int,
	`format` enum('html','docx','pdf') NOT NULL,
	`renderHash` varchar(32) NOT NULL,
	`renderedContent` longtext,
	`renderedAt` timestamp,
	`expiresAt` timestamp,
	`status` enum('pending','processing','ready','failed') NOT NULL DEFAULT 'pending',
	`storageKey` varchar(500),
	`fileSize` int,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_render_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_timeline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`documentId` int NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`actorId` int NOT NULL,
	`actorName` varchar(255),
	`actorEmail` varchar(320),
	`actorRole` varchar(50),
	`versionId` int,
	`fromState` varchar(50),
	`toState` varchar(50),
	`details` json,
	`correlationId` varchar(36),
	`requestId` varchar(36),
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_timeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`documentId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`contentSnapshot` text,
	`structuredSnapshot` json,
	`diffMetadata` json,
	`changeReason` varchar(500),
	`sourceContext` enum('manual','autosave_publish','ai','import','restore','workflow') NOT NULL DEFAULT 'manual',
	`actorSnapshot` json NOT NULL,
	`workflowSnapshot` json,
	`correlationId` varchar(36),
	`requestId` varchar(36),
	`snapshotFingerprint` varchar(64),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `feature_flags` (
	`name` varchar(100) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`reason` varchar(255),
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feature_flags_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
	`id` varchar(36) NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`key` varchar(255) NOT NULL,
	`operation` varchar(100) NOT NULL,
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`requestPayloadHash` varchar(64),
	`responsePayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_org_user_key` UNIQUE(`organizationId`,`userId`,`key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','manager','operator','viewer') NOT NULL DEFAULT 'operator',
	`invitedBy` int,
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `org_members_org_user_unique` UNIQUE(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(255) NOT NULL,
	`cnpj` varchar(18),
	`slug` varchar(100) NOT NULL,
	`esfera` enum('federal','estadual','municipal','outro') DEFAULT 'municipal',
	`uf` varchar(2),
	`municipio` varchar(100),
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_cnpj_unique` UNIQUE(`cnpj`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outbox_dead_letters` (
	`id` varchar(36) NOT NULL,
	`organizationId` int,
	`eventType` varchar(100) NOT NULL,
	`aggregateType` varchar(50) NOT NULL,
	`aggregateId` varchar(50) NOT NULL,
	`correlationId` varchar(36),
	`payload` json NOT NULL,
	`attempts` int NOT NULL,
	`lastError` text,
	`movedAt` timestamp NOT NULL DEFAULT (now()),
	`resolution` enum('pending','resolved','discarded') NOT NULL DEFAULT 'pending',
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`resolvedNote` text,
	CONSTRAINT `outbox_dead_letters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outbox_events` (
	`id` varchar(36) NOT NULL,
	`organizationId` int,
	`eventType` varchar(100) NOT NULL,
	`aggregateType` varchar(50) NOT NULL,
	`aggregateId` varchar(50) NOT NULL,
	`correlationId` varchar(36),
	`requestId` varchar(36),
	`actorId` int,
	`actorName` varchar(255),
	`tenantContext` json,
	`payload` json NOT NULL,
	`status` enum('pending','processing','delivered','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastError` text,
	`lockedBy` varchar(100),
	`lockedUntil` timestamp,
	`scheduledAfter` timestamp,
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `parser_capabilities` (
	`id` varchar(26) NOT NULL,
	`parserType` enum('xlsx','xls','csv','docx','pdf','auto') NOT NULL,
	`parserVersion` varchar(20) NOT NULL,
	`supportsMultiSheet` boolean NOT NULL DEFAULT false,
	`supportsMultiPage` boolean NOT NULL DEFAULT false,
	`supportsFormulas` boolean NOT NULL DEFAULT false,
	`supportsMergedCells` boolean NOT NULL DEFAULT false,
	`supportsImages` boolean NOT NULL DEFAULT false,
	`supportsHeaders` boolean NOT NULL DEFAULT true,
	`supportsFooters` boolean NOT NULL DEFAULT false,
	`descriptionConfidence` decimal(4,3) NOT NULL,
	`quantityConfidence` decimal(4,3) NOT NULL,
	`unitConfidence` decimal(4,3) NOT NULL,
	`priceConfidence` decimal(4,3) NOT NULL,
	`limitations` json,
	`requiresManualUnitReview` boolean NOT NULL DEFAULT false,
	`requiresManualPriceReview` boolean NOT NULL DEFAULT false,
	`likelihoodMergedHeaders` decimal(4,3) NOT NULL DEFAULT '0',
	`likelihoodFooterRows` decimal(4,3) NOT NULL DEFAULT '0',
	`registeredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `parser_capabilities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retrieval_evidences_v2` (
	`id` varchar(20) NOT NULL,
	`organization_id` int NOT NULL,
	`retrieval_session_id` varchar(20) NOT NULL,
	`chunk_id` varchar(20) NOT NULL,
	`similarity_score` decimal(10,6) NOT NULL DEFAULT '0',
	`bm25_score` decimal(10,6) NOT NULL DEFAULT '0',
	`rerank_score` decimal(10,6) NOT NULL DEFAULT '0',
	`final_score` decimal(10,6) NOT NULL DEFAULT '0',
	`ranking_reason` text,
	`semantic_explanation` text,
	`evidence_type` varchar(50) NOT NULL DEFAULT 'semantic_match',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `retrieval_evidences_v2_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retrieval_sessions_v2` (
	`id` varchar(20) NOT NULL,
	`organization_id` int NOT NULL,
	`query_text` text,
	`normalized_query` text,
	`retrieval_strategy` varchar(50) NOT NULL DEFAULT 'vector_similarity',
	`reranking_enabled` tinyint NOT NULL DEFAULT 0,
	`embedding_version` varchar(20) NOT NULL DEFAULT 'v1',
	`retrieved_chunks` text,
	`retrieval_trace` text,
	`explainability_data` text,
	`latency_ms` int NOT NULL DEFAULT 0,
	`correlation_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `retrieval_sessions_v2_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `semantic_chunks_v2` (
	`id` varchar(20) NOT NULL,
	`organization_id` int NOT NULL,
	`document_id` varchar(255) NOT NULL,
	`source_type` varchar(50) NOT NULL DEFAULT 'document',
	`source_snapshot_id` varchar(64),
	`chunk_index` int NOT NULL DEFAULT 0,
	`chunk_hash` varchar(64) NOT NULL,
	`chunk_text` text,
	`normalized_text` text,
	`semantic_metadata` text,
	`chunk_strategy` varchar(50) NOT NULL DEFAULT 'paragraph_chunking',
	`token_count` int NOT NULL DEFAULT 0,
	`language` varchar(10) NOT NULL DEFAULT 'pt-BR',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `semantic_chunks_v2_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stage_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`docType` enum('dfd','etp','tr','edital','contrato','ata','parecer') NOT NULL,
	`assignedUserId` int NOT NULL,
	`assignedBy` int NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stage_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tenant_feature_flags` (
	`organizationId` int NOT NULL,
	`flagName` varchar(100) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT false,
	`percentage` int DEFAULT 100,
	`expiresAt` timestamp,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenant_feature_flags_organizationId_flagName_pk` PRIMARY KEY(`organizationId`,`flagName`)
);
