CREATE TABLE IF NOT EXISTS `document_references` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `origin_domain` VARCHAR(50) NOT NULL DEFAULT '',
  `document_id` VARCHAR(20) NOT NULL DEFAULT '', `version` INT NOT NULL DEFAULT 1,
  `snapshot` VARCHAR(64) NOT NULL DEFAULT '', `title` VARCHAR(500) NOT NULL DEFAULT '',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_docref_org` (`organization_id`), INDEX `idx_docref_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
