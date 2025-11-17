CREATE TABLE `direct_contract_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`directContractId` int NOT NULL,
	`action` enum('created','updated','status_changed','document_generated','document_downloaded','quotation_added','quotation_deleted','package_generated','checklist_updated','approved','published','ratified','completed') NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `direct_contract_audit_logs_id` PRIMARY KEY(`id`)
);
