CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`targetUserId` int,
	`action` enum('promote_to_admin','demote_from_admin','deactivate_user','activate_user','delete_user','view_user_data','export_user_data','other') NOT NULL,
	`details` text,
	`ipAddress` varchar(45),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_consents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`consentType` enum('terms_of_use','privacy_policy','data_processing') NOT NULL,
	`version` varchar(20) NOT NULL,
	`accepted` boolean NOT NULL DEFAULT true,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_consents_id` PRIMARY KEY(`id`)
);
