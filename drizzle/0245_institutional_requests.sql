CREATE TABLE IF NOT EXISTS `institutional_requests` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `source_domain` VARCHAR(50) NOT NULL DEFAULT '', `destination_domain` VARCHAR(50) NOT NULL DEFAULT '',
  `request_type` VARCHAR(40) NOT NULL DEFAULT 'INFORMATION_REQUEST',
  `reference_process_id` VARCHAR(20) NOT NULL DEFAULT '', `reference_document_id` VARCHAR(20) NOT NULL DEFAULT '',
  `title` VARCHAR(500) NOT NULL DEFAULT '', `description` TEXT NULL,
  `priority` VARCHAR(20) NOT NULL DEFAULT 'media', `status` VARCHAR(30) NOT NULL DEFAULT 'NEW',
  `requested_by` INT NOT NULL DEFAULT 0, `assigned_to` INT NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ireq_org` (`organization_id`),
  INDEX `idx_ireq_dest` (`destination_domain`), INDEX `idx_ireq_src` (`source_domain`),
  INDEX `idx_ireq_status` (`status`), INDEX `idx_ireq_org_dest` (`organization_id`, `destination_domain`),
  INDEX `idx_ireq_process` (`reference_process_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
