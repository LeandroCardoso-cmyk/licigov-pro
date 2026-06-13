CREATE TABLE `provider_cost_analytics` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `provider_id` VARCHAR(20) NOT NULL,
  `model` VARCHAR(255) NOT NULL,
  `prompt_tokens` INT NOT NULL DEFAULT 0,
  `completion_tokens` INT NOT NULL DEFAULT 0,
  `total_cost` DECIMAL(10,6) NOT NULL DEFAULT 0,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pca_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
