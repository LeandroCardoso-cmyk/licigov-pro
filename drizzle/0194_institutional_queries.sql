CREATE TABLE `institutional_queries` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `workflow_id` VARCHAR(20) NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `query` TEXT NULL,
  `normalized_query` TEXT NULL,
  `intent` VARCHAR(50) NOT NULL DEFAULT 'general',
  `query_type` VARCHAR(50) NOT NULL DEFAULT 'factual',
  `context_strategy` VARCHAR(50) NOT NULL DEFAULT 'selective',
  `retrieval_strategy` VARCHAR(50) NOT NULL DEFAULT 'hybrid',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_iq_org` (`organization_id`),
  INDEX `idx_iq_user` (`user_id`),
  INDEX `idx_iq_intent` (`intent`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
