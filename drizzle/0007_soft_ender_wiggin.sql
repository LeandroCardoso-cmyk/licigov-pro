CREATE TABLE `document_embeddings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`knowledgeBaseId` int NOT NULL,
	`embedding` text NOT NULL,
	`chunkIndex` int NOT NULL DEFAULT 0,
	`chunkText` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_embeddings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledge_base` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`type` enum('law','jurisprudence','template','user_document') NOT NULL,
	`source` varchar(255),
	`metadata` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_base_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`subscriptionId` int NOT NULL,
	`amount` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'BRL',
	`status` enum('succeeded','pending','failed','refunded') NOT NULL DEFAULT 'pending',
	`stripePaymentIntentId` varchar(255),
	`stripeInvoiceId` varchar(255),
	`invoiceUrl` text,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_stripePaymentIntentId_unique` UNIQUE(`stripePaymentIntentId`)
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`price` int NOT NULL,
	`interval` enum('monthly','yearly') NOT NULL DEFAULT 'monthly',
	`maxUsers` int NOT NULL DEFAULT 1,
	`maxProcessesPerMonth` int NOT NULL DEFAULT 10,
	`maxStorageGB` int NOT NULL DEFAULT 2,
	`hasDocumentGeneration` boolean NOT NULL DEFAULT true,
	`hasDirectContracting` boolean NOT NULL DEFAULT false,
	`hasLegalOpinion` boolean NOT NULL DEFAULT false,
	`hasPCA` boolean NOT NULL DEFAULT false,
	`hasContracts` boolean NOT NULL DEFAULT false,
	`hasDepartmentManagement` boolean NOT NULL DEFAULT false,
	`hasCollaboration` boolean NOT NULL DEFAULT false,
	`hasComments` boolean NOT NULL DEFAULT false,
	`hasVersioning` boolean NOT NULL DEFAULT false,
	`hasPrioritySupport` boolean NOT NULL DEFAULT false,
	`hasSLA` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`stripeProductId` varchar(255),
	`stripePriceId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscription_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscription_plans_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`planId` int NOT NULL,
	`status` enum('active','canceled','past_due','unpaid','trialing','incomplete') NOT NULL DEFAULT 'active',
	`stripeSubscriptionId` varchar(255),
	`stripeCustomerId` varchar(255),
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`trialStart` timestamp,
	`trialEnd` timestamp,
	`canceledAt` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_stripeSubscriptionId_unique` UNIQUE(`stripeSubscriptionId`)
);
--> statement-breakpoint
CREATE TABLE `usage_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`month` varchar(7) NOT NULL,
	`processesCreated` int NOT NULL DEFAULT 0,
	`storageUsedMB` int NOT NULL DEFAULT 0,
	`activeUsers` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_tracking_id` PRIMARY KEY(`id`)
);
