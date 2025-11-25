CREATE TABLE `digital_signatures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentType` enum('legal_opinion','contract','amendment','apostille','rescission') NOT NULL,
	`documentId` int NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`signature` text NOT NULL,
	`signedBy` int NOT NULL,
	`signedByName` text NOT NULL,
	`signedByEmail` varchar(320),
	`certificateInfo` json,
	`signedAt` timestamp NOT NULL DEFAULT (now()),
	`isValid` boolean NOT NULL DEFAULT true,
	`notes` text,
	CONSTRAINT `digital_signatures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `legal_opinions` ADD `signatureId` int;