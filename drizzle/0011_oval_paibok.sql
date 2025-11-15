CREATE TABLE `contract_renewals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subscriptionId` int NOT NULL,
	`renewalNumber` int NOT NULL,
	`previousEndDate` timestamp NOT NULL,
	`newEndDate` timestamp NOT NULL,
	`termoAditivoFileUrl` text,
	`termoAditivoFileKey` text,
	`numeroEmpenho` varchar(100),
	`valorRenovacao` int,
	`renewedBy` int NOT NULL,
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contract_renewals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `renewalCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `originalStartDate` timestamp;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `lastRenewalDate` timestamp;