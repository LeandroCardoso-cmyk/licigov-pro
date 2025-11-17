CREATE TABLE `direct_contract_checklist_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`directContractId` int NOT NULL,
	`stepNumber` int NOT NULL,
	`isCompleted` boolean NOT NULL DEFAULT false,
	`completedBy` int,
	`completedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `direct_contract_checklist_progress_id` PRIMARY KEY(`id`)
);
