CREATE TABLE IF NOT EXISTS `official_document_timeline` (
  `id` VARCHAR(20) NOT NULL, `tenant_id` INT NOT NULL,
  `lineage_id` VARCHAR(20) NOT NULL DEFAULT '', `document_id` VARCHAR(20) NOT NULL DEFAULT '',
  `event_order` INT NOT NULL DEFAULT 0, `event_type` VARCHAR(40) NOT NULL DEFAULT '', `actor` VARCHAR(60) NOT NULL DEFAULT '',
  `summary` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_odtl_tenant` (`tenant_id`), INDEX `idx_odtl_lineage` (`lineage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
