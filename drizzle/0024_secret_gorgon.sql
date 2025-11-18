CREATE TABLE `contract_amendments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`number` int NOT NULL,
	`type` enum('prazo','valor','escopo','misto') NOT NULL,
	`justification` text NOT NULL,
	`newEndDate` timestamp,
	`daysAdded` int,
	`valueChange` int,
	`newTotalValue` int,
	`scopeChanges` text,
	`signedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int NOT NULL,
	CONSTRAINT `contract_amendments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contract_apostilles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`number` int NOT NULL,
	`type` enum('reajuste','correcao','designacao','outro') NOT NULL,
	`description` text NOT NULL,
	`valueChange` int,
	`newTotalValue` int,
	`indexType` varchar(50),
	`indexValue` varchar(20),
	`signedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int NOT NULL,
	CONSTRAINT `contract_apostilles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contract_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`action` enum('created','updated','status_changed','amendment_added','apostille_added','document_generated','document_downloaded','renewed','suspended','terminated','completed') NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contract_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contract_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` int NOT NULL,
	`type` enum('minuta','aditivo','apostilamento','rescisao','outro') NOT NULL,
	`referenceId` int,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','final','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contract_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`number` varchar(50) NOT NULL,
	`year` int NOT NULL,
	`object` text NOT NULL,
	`type` enum('fornecimento','servico','obra','concessao','outro') NOT NULL,
	`originType` enum('processo','contratacao_direta','manual'),
	`originId` int,
	`contractorName` varchar(255) NOT NULL,
	`contractorCNPJ` varchar(18),
	`contractorAddress` text,
	`contractorContact` varchar(100),
	`value` int NOT NULL,
	`currentValue` int NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`autoRenewal` boolean NOT NULL DEFAULT false,
	`maxRenewals` int DEFAULT 0,
	`currentRenewals` int DEFAULT 0,
	`fiscalUserId` int,
	`fiscalUserName` varchar(255),
	`status` enum('draft','active','suspended','terminated','expired','completed') NOT NULL DEFAULT 'draft',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdBy` int NOT NULL,
	CONSTRAINT `contracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `contracts_number_unique` UNIQUE(`number`)
);
