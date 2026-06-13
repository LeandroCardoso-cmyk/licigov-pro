CREATE TABLE `provider_routing` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `routing_strategy` ENUM('lowest_latency','lowest_cost','highest_reliability','deterministic_priority','capability_match') NOT NULL DEFAULT 'deterministic_priority',
  `fallback_strategy` ENUM('next_provider','mock_fallback','fail_fast','degraded_mode') NOT NULL DEFAULT 'next_provider',
  `preferred_providers` TEXT NULL,
  `capability_routing` TEXT NULL,
  `cost_optimization` TINYINT(1) NOT NULL DEFAULT 0,
  `latency_optimization` TINYINT(1) NOT NULL DEFAULT 0,
  `resilience_mode` TINYINT(1) NOT NULL DEFAULT 1,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_pr_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
