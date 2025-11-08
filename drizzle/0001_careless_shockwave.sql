CREATE TABLE `activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`userId` int NOT NULL,
	`action` varchar(255) NOT NULL,
	`details` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`type` enum('etp','tr','dfd','edital') NOT NULL,
	`content` text,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `edital_parameters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`modalidade` varchar(100),
	`formato` enum('presencial','eletronico'),
	`criterioJulgamento` varchar(100),
	`regimeContratacao` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `edital_parameters_id` PRIMARY KEY(`id`),
	CONSTRAINT `edital_parameters_processId_unique` UNIQUE(`processId`)
);
--> statement-breakpoint
CREATE TABLE `process_collaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('administrador','editor','leitor') NOT NULL DEFAULT 'leitor',
	`invitedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `process_collaborators_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`object` text,
	`status` enum('em_etp','em_tr','em_dfd','em_edital','concluido') NOT NULL DEFAULT 'em_etp',
	`ownerId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processes_id` PRIMARY KEY(`id`)
);
