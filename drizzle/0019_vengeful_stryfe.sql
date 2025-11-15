CREATE TABLE `platform_api_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platformId` int NOT NULL,
	`apiKey` text,
	`apiSecret` text,
	`clientId` text,
	`clientSecret` text,
	`accessToken` text,
	`refreshToken` text,
	`tokenExpiresAt` timestamp,
	`webhookUrl` text,
	`webhookSecret` text,
	`isActive` boolean NOT NULL DEFAULT false,
	`lastTestedAt` timestamp,
	`lastTestStatus` enum('success','failed','not_tested') DEFAULT 'not_tested',
	`lastTestError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_api_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_api_configs_platformId_unique` UNIQUE(`platformId`)
);
--> statement-breakpoint
CREATE TABLE `platform_checklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platformId` int NOT NULL,
	`stepNumber` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`fields` json,
	`requiredDocuments` json,
	`helpUrl` text,
	`screenshotUrl` text,
	`category` varchar(100),
	`isOptional` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_checklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicationId` int NOT NULL,
	`platformId` int NOT NULL,
	`type` enum('new_proposal','proposal_updated','impugnation','clarification_request','session_started','session_ended','winner_declared','other') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`webhookPayload` json,
	`isRead` boolean NOT NULL DEFAULT false,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_publications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`platformId` int NOT NULL,
	`externalId` varchar(255),
	`externalUrl` text,
	`status` enum('draft','published','scheduled','failed','cancelled','closed') NOT NULL DEFAULT 'draft',
	`publishedAt` timestamp,
	`scheduledFor` timestamp,
	`closedAt` timestamp,
	`apiResponse` json,
	`errorMessage` text,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_publications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platformId` int NOT NULL,
	`documentType` enum('etp','tr','dfd','edital') NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`templateInstructions` text NOT NULL,
	`metadata` json,
	`mandatoryClauses` json,
	`terminology` json,
	`version` int NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`logoUrl` text,
	`websiteUrl` text,
	`config` json,
	`hasApiIntegration` boolean NOT NULL DEFAULT false,
	`apiBaseUrl` text,
	`apiAuthType` enum('none','api_key','oauth2','basic_auth'),
	`apiDocumentationUrl` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`displayOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platforms_id` PRIMARY KEY(`id`),
	CONSTRAINT `platforms_slug_unique` UNIQUE(`slug`)
);
