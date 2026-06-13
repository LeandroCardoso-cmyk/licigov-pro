CREATE TABLE `provider_policies` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `policy_name` VARCHAR(255) NOT NULL,
  `allowed_providers` TEXT NULL,
  `blocked_models` TEXT NULL,
  `max_tokens_per_execution` INT NOT NULL DEFAULT 100000,
  `max_cost_per_execution` DECIMAL(10,4) NOT NULL DEFAULT 10.0,
  `daily_cost_limit` DECIMAL(10,4) NOT NULL DEFAULT 100.0,
  `approval_threshold` DECIMAL(10,4) NOT NULL DEFAULT 5.0,
  `requires_human_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `restricted_capabilities` TEXT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pp_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
