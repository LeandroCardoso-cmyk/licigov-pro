CREATE TABLE `ai_usage_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`processId` int,
	`operationType` enum('embedding','rag_query','catmat_matching','document_generation') NOT NULL,
	`model` varchar(50) NOT NULL,
	`inputTokens` int NOT NULL,
	`outputTokens` int NOT NULL,
	`estimatedCostUSD` decimal(10,6) NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_usage_tracking_id` PRIMARY KEY(`id`)
);
