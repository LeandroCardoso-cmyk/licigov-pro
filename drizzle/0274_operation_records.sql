CREATE TABLE IF NOT EXISTS `operation_records` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `record_type` VARCHAR(40) NOT NULL DEFAULT 'outro', `origin` VARCHAR(10) NOT NULL DEFAULT 'externa',
  `number` VARCHAR(80) NOT NULL DEFAULT '', `object` TEXT NULL, `modality` VARCHAR(60) NOT NULL DEFAULT '',
  `current_stage` VARCHAR(60) NOT NULL DEFAULT '', `responsible` INT NULL,
  `reference_type` VARCHAR(40) NOT NULL DEFAULT '', `reference_id` VARCHAR(64) NOT NULL DEFAULT '',
  `document_references` TEXT NULL, `notes` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_oprec_org` (`organization_id`), INDEX `idx_oprec_type` (`organization_id`, `record_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
