CREATE TABLE IF NOT EXISTS `legal_opinion_versions` (
  `id` VARCHAR(32) NOT NULL, `organization_id` INT NOT NULL,
  `draft_id` VARCHAR(20) NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `version` INT NOT NULL DEFAULT 1, `content_hash` VARCHAR(64) NOT NULL DEFAULT '',
  `snapshot` TEXT NULL, `author` INT NOT NULL DEFAULT 0, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_lov_org` (`organization_id`),
  INDEX `idx_lov_draft` (`draft_id`), INDEX `idx_lov_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
