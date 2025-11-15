CREATE TABLE `direct_contract_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`directContractId` int NOT NULL,
	`type` enum('termo_dispensa','termo_inexigibilidade','dfd','tr','minuta_contrato','planilha_cotacao','mapa_comparativo','ata_ratificacao','outro') NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','final','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `direct_contract_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `direct_contract_legal_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('dispensa','inexigibilidade') NOT NULL,
	`article` varchar(20) NOT NULL,
	`inciso` varchar(10),
	`description` text NOT NULL,
	`summary` varchar(500) NOT NULL,
	`valueLimit` int,
	`examples` json,
	`requiredDocuments` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `direct_contract_legal_articles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `direct_contract_quotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`directContractId` int NOT NULL,
	`supplierName` varchar(255) NOT NULL,
	`supplierCNPJ` varchar(18),
	`supplierContact` varchar(100),
	`value` int NOT NULL,
	`deliveryDeadline` int,
	`paymentTerms` varchar(255),
	`attachmentUrl` varchar(500),
	`notes` text,
	`isSelected` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `direct_contract_quotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `direct_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int,
	`number` varchar(50) NOT NULL,
	`year` int NOT NULL,
	`type` enum('dispensa','inexigibilidade') NOT NULL,
	`legalArticleId` int NOT NULL,
	`object` text NOT NULL,
	`justification` text NOT NULL,
	`value` int NOT NULL,
	`executionDeadline` int,
	`supplierName` varchar(255),
	`supplierCNPJ` varchar(18),
	`supplierAddress` text,
	`supplierContact` varchar(100),
	`mode` enum('presencial','eletronico') NOT NULL DEFAULT 'presencial',
	`platformId` int,
	`status` enum('draft','pending_approval','approved','published','in_execution','completed','cancelled') NOT NULL DEFAULT 'draft',
	`approvedAt` timestamp,
	`publishedAt` timestamp,
	`ratifiedAt` timestamp,
	`completedAt` timestamp,
	`metadata` json,
	`createdBy` int NOT NULL,
	`approvedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `direct_contracts_id` PRIMARY KEY(`id`)
);
