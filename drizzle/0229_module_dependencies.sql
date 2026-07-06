CREATE TABLE IF NOT EXISTS `module_dependencies` (
  `id` VARCHAR(20) NOT NULL, `dependent_code` VARCHAR(50) NOT NULL DEFAULT '',
  `kind` VARCHAR(20) NOT NULL DEFAULT 'domain',
  `depends_on` VARCHAR(50) NOT NULL DEFAULT '', `required` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_mdep_dependent` (`dependent_code`),
  INDEX `idx_mdep_kind` (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
