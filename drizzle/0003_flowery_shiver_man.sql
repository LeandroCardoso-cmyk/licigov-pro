CREATE TABLE `documentSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`organizationName` text,
	`logoUrl` text,
	`address` text,
	`cnpj` varchar(18),
	`phone` varchar(20),
	`email` varchar(320),
	`website` varchar(255),
	`footerText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documentSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP TABLE `process_collaborators`;