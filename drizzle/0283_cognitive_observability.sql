CREATE TABLE IF NOT EXISTS `cognitive_observability` (
  `id` VARCHAR(20) NOT NULL, `tenant_id` INT NOT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '', `task` VARCHAR(40) NOT NULL DEFAULT '',
  `replay_hash` VARCHAR(64) NOT NULL DEFAULT '', `reasoning_plan_id` VARCHAR(20) NOT NULL DEFAULT '',
  `reasoning_plan_hash` VARCHAR(64) NOT NULL DEFAULT '', `provider` VARCHAR(40) NOT NULL DEFAULT '',
  `latency_ms` INT NOT NULL DEFAULT 0, `total_tokens` INT NOT NULL DEFAULT 0,
  `structured_output_valid` TINYINT NOT NULL DEFAULT 1, `execution_status` VARCHAR(20) NOT NULL DEFAULT 'completed',
  `payload` LONGTEXT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_cobs_corr` (`correlation_id`), INDEX `idx_cobs_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
