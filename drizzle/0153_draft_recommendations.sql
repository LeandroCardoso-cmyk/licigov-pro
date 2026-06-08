CREATE TABLE IF NOT EXISTS `draft_recommendations` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `trace_id` VARCHAR(20) NOT NULL,
  `recommendation_type` ENUM('mandatory','advisory','optional','warning') NOT NULL DEFAULT 'advisory',
  `content` TEXT NULL,
  `legal_basis` VARCHAR(500) NOT NULL DEFAULT '',
  `priority` INT NOT NULL DEFAULT 1,
  `rationale` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_dr_org` (`organization_id`),
  INDEX `idx_dr_trace` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
