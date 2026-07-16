CREATE TABLE IF NOT EXISTS `official_documents` (
  `id` VARCHAR(20) NOT NULL, `tenant_id` INT NOT NULL,
  `business_domain` VARCHAR(40) NOT NULL DEFAULT '', `document_type` VARCHAR(40) NOT NULL DEFAULT 'outro',
  `origin` VARCHAR(64) NOT NULL DEFAULT '', `title` VARCHAR(500) NOT NULL DEFAULT '',
  `version` INT NOT NULL DEFAULT 1, `status` VARCHAR(20) NOT NULL DEFAULT 'gerado', `template` VARCHAR(120) NOT NULL DEFAULT '',
  `content` LONGTEXT NULL, `metadata` TEXT NULL, `author` VARCHAR(60) NOT NULL DEFAULT '',
  `lineage_id` VARCHAR(20) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '', `replay_hash` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_odoc_tenant` (`tenant_id`),
  INDEX `idx_odoc_lineage` (`tenant_id`, `lineage_id`), INDEX `idx_odoc_domain` (`tenant_id`, `business_domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
