CREATE TABLE IF NOT EXISTS `compliance_checks` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `trace_id` VARCHAR(20) NOT NULL,
  `rule_id` VARCHAR(100) NOT NULL,
  `rule_name` VARCHAR(255) NOT NULL,
  `legal_basis` VARCHAR(500) NOT NULL DEFAULT '',
  `status` ENUM('compliant','non_compliant','uncertain','not_applicable') NOT NULL DEFAULT 'uncertain',
  `findings` TEXT NULL,
  `remediation` TEXT NULL,
  `check_score` DECIMAL(5,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_cc_org` (`organization_id`),
  INDEX `idx_cc_trace` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
