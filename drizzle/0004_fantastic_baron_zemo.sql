CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`type` enum('member_added','document_edited','document_approved','comment_added','general') NOT NULL DEFAULT 'general',
	`processId` int,
	`documentId` int,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `process_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processId` int NOT NULL,
	`userId` int NOT NULL,
	`permission` enum('viewer','editor','approver','owner') NOT NULL DEFAULT 'viewer',
	`invitedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `process_members_id` PRIMARY KEY(`id`)
);
