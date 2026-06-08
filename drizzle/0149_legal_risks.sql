CREATE TABLE IF NOT EXISTS `legal_risks` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `trace_id` VARCHAR(20) NOT NULL,
  `risk_type` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `level` ENUM('critical','high','medium','low','negligible') NOT NULL DEFAULT 'medium',
  `legal_basis` VARCHAR(500) NOT NULL DEFAULT '',
  `probability` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `impact` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `risk_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_lr_org` (`organization_id`),
  INDEX `idx_lr_trace` (`trace_id`),
  INDEX `idx_lr_level` (`organization_id`, `level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
