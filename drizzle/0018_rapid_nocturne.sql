CREATE TABLE `embedding_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`textHash` varchar(64) NOT NULL,
	`text` text NOT NULL,
	`embedding` json NOT NULL,
	`model` varchar(50) NOT NULL,
	`hitCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `embedding_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `embedding_cache_textHash_unique` UNIQUE(`textHash`)
);
