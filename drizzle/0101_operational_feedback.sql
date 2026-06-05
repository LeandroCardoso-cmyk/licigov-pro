CREATE TABLE `operational_feedback` (
  `id` varchar(128) NOT NULL,
  `organization_id` int NOT NULL,
  `user_hash` varchar(32) NOT NULL,
  `category` varchar(64) NOT NULL,
  `severity` varchar(16) NOT NULL DEFAULT 'low',
  `feature` varchar(256) NOT NULL,
  `message` text NOT NULL,
  `rating` tinyint NULL,
  `metadata` json NOT NULL,
  `collected_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_of_org` (`organization_id`),
  INDEX `idx_of_category` (`category`),
  INDEX `idx_of_severity` (`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
