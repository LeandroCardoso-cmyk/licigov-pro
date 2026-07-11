CREATE TABLE IF NOT EXISTS `legal_opinion_drafts` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `workspace_id` VARCHAR(20) NOT NULL, `request_id` VARCHAR(20) NOT NULL,
  `opinion_type` VARCHAR(40) NOT NULL DEFAULT 'LEGAL_OPINION_INITIAL',
  `report` TEXT NULL, `foundation` TEXT NULL, `conclusion` TEXT NULL,
  `conclusion_type` VARCHAR(30) NULL, `recommendations` TEXT NULL, `reservations` TEXT NULL, `attachments` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'rascunho', `version` INT NOT NULL DEFAULT 1,
  `signed` INT NOT NULL DEFAULT 0, `signature_method` VARCHAR(30) NULL, `signed_by` INT NULL, `signed_at` VARCHAR(40) NULL,
  `author` INT NOT NULL DEFAULT 0, `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_lod_org` (`organization_id`),
  INDEX `idx_lod_workspace` (`workspace_id`), INDEX `idx_lod_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
