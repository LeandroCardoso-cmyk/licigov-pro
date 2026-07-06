CREATE TABLE IF NOT EXISTS `generated_documents` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `process_id` VARCHAR(20) NOT NULL, `kind` VARCHAR(20) NOT NULL DEFAULT 'etp',
  `title` VARCHAR(500) NOT NULL DEFAULT '', `content` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'rascunho', `sources` TEXT NULL,
  `modality` VARCHAR(40) NULL, `form` VARCHAR(20) NULL, `platform` VARCHAR(40) NULL,
  `legal_justification` TEXT NULL, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_gd_org` (`organization_id`),
  INDEX `idx_gd_process` (`process_id`), INDEX `idx_gd_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
