CREATE TABLE `provider_replay_snapshots` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `original_execution_id` VARCHAR(20) NOT NULL,
  `snapshot_key` VARCHAR(64) NOT NULL,
  `request_payload` TEXT NULL,
  `response_payload` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_prs_org` (`organization_id`),
  INDEX `idx_prs_key` (`snapshot_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
