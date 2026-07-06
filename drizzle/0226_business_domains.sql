CREATE TABLE IF NOT EXISTS `business_domains` (
  `id` VARCHAR(20) NOT NULL, `code` VARCHAR(50) NOT NULL DEFAULT '',
  `name` VARCHAR(255) NOT NULL DEFAULT '', `description` TEXT NULL,
  `category` VARCHAR(30) NOT NULL DEFAULT 'core',
  `active` TINYINT NOT NULL DEFAULT 1, `version` INT NOT NULL DEFAULT 1,
  `dependencies` TEXT NULL, `required_kernel_services` TEXT NULL,
  `supported_workflows` TEXT NULL,
  `workspace_type` VARCHAR(50) NOT NULL DEFAULT 'generico',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_bd_code` (`code`),
  INDEX `idx_bd_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
