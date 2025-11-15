CREATE TABLE `process_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`itemType` enum('material','service') NOT NULL,
	`catmatCode` int,
	`catserCode` int,
	`description` text NOT NULL,
	`unit` varchar(50) NOT NULL,
	`groupCode` int,
	`groupDescription` text,
	`classCode` int,
	`classDescription` text,
	`quantity` int,
	`estimatedPrice` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `process_items_id` PRIMARY KEY(`id`)
);
