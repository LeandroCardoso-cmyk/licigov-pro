CREATE TABLE `catmat_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processItemId` int NOT NULL,
	`catmatCode` varchar(20) NOT NULL,
	`description` text NOT NULL,
	`confidenceScore` int NOT NULL,
	`reasoning` text,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catmat_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `law_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lawName` varchar(100) NOT NULL,
	`chunkIndex` int NOT NULL,
	`articleNumber` varchar(20),
	`content` text NOT NULL,
	`embedding` json NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `law_chunks_id` PRIMARY KEY(`id`)
);
