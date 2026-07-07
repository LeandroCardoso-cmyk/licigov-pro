CREATE TABLE IF NOT EXISTS `institutional_responses` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `request_id` VARCHAR(20) NOT NULL, `responder` INT NOT NULL DEFAULT 0,
  `response_type` VARCHAR(30) NOT NULL DEFAULT 'informacao',
  `response_status` VARCHAR(30) NOT NULL DEFAULT 'concluido',
  `comments` TEXT NULL, `attached_documents` TEXT NULL,
  `signed` TINYINT NOT NULL DEFAULT 0, `signature_method` VARCHAR(30) NULL, `signed_at` VARCHAR(30) NULL,
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_ires_org` (`organization_id`), INDEX `idx_ires_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
