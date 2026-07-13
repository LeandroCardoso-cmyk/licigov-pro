CREATE TABLE IF NOT EXISTS `required_documents` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `name` VARCHAR(500) NOT NULL DEFAULT '', `required` INT NOT NULL DEFAULT 1, `status` VARCHAR(20) NOT NULL DEFAULT 'pendente',
  `document_reference` VARCHAR(500) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_rqd_org` (`organization_id`), INDEX `idx_rqd_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
