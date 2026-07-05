CREATE TABLE `evidence_graphs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `grounding_session_id` VARCHAR(20) NOT NULL,
  `nodes` JSON NULL,
  `edges` JSON NULL,
  `version` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_eg_org` (`organization_id`),
  INDEX `idx_eg_session` (`grounding_session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
