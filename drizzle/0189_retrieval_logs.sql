CREATE TABLE `retrieval_logs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `session_id` VARCHAR(20) NOT NULL,
  `operation` ENUM('search','rerank','expand','filter') NOT NULL DEFAULT 'search',
  `latency_ms` INT NOT NULL DEFAULT 0,
  `result_count` INT NOT NULL DEFAULT 0,
  `correlation_id` VARCHAR(64) NOT NULL,
  `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rl_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
