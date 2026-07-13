CREATE TABLE IF NOT EXISTS `proposal_collections` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `supplier_name` VARCHAR(255) NOT NULL DEFAULT '', `supplier_document` VARCHAR(40) NOT NULL DEFAULT '',
  `proposal_value` DECIMAL(15,2) NOT NULL DEFAULT 0, `protocol` VARCHAR(120) NOT NULL DEFAULT '',
  `received_via` VARCHAR(30) NOT NULL DEFAULT 'protocolo', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_prc_org` (`organization_id`), INDEX `idx_prc_workspace` (`workspace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
