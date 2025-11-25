CREATE TABLE `signature_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opinionId` int NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255) NOT NULL,
	`userEmail` varchar(320),
	`signerRole` enum('revisor','responsavel','gestor') NOT NULL,
	`documentHash` varchar(64) NOT NULL,
	`signature` text NOT NULL,
	`certificateInfo` json,
	`isValid` boolean NOT NULL DEFAULT true,
	`signedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signature_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `legal_opinions` ADD `requiredSignatures` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `signaturePassword` varchar(255);--> statement-breakpoint
ALTER TABLE `legal_opinions` DROP COLUMN `signatureId`;