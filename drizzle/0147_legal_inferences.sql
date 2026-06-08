CREATE TABLE IF NOT EXISTS `legal_inferences` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `trace_id` VARCHAR(20) NOT NULL,
  `conclusion` TEXT NULL,
  `inference_type` ENUM('deductive','inductive','analogical','abductive') NOT NULL DEFAULT 'deductive',
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.75,
  `legal_basis` VARCHAR(500) NOT NULL DEFAULT '',
  `justification` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_li_org` (`organization_id`),
  INDEX `idx_li_trace` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
