CREATE TABLE IF NOT EXISTS `proposal_documents` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL, `proposal_id` VARCHAR(20) NOT NULL, `workspace_id` VARCHAR(20) NOT NULL,
  `kind` VARCHAR(30) NOT NULL DEFAULT 'proposta_pdf', `title` VARCHAR(500) NOT NULL DEFAULT '',
  `document_reference` VARCHAR(500) NOT NULL DEFAULT '', `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_prd_org` (`organization_id`), INDEX `idx_prd_proposal` (`proposal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
