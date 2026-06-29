CREATE TABLE `response_citations` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `response_id` VARCHAR(20) NOT NULL,
  `evidence_id` VARCHAR(20) NULL,
  `chunk_id` VARCHAR(20) NULL,
  `citation_text` TEXT NULL,
  `source_document` VARCHAR(500) NOT NULL DEFAULT '',
  `page` VARCHAR(50) NULL,
  `section` VARCHAR(255) NULL,
  `similarity` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
  `citation_type` VARCHAR(50) NOT NULL DEFAULT 'direct_quote',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rcit_org` (`organization_id`),
  INDEX `idx_rcit_response` (`response_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
