CREATE TABLE IF NOT EXISTS `kernel_services` (
  `id` VARCHAR(20) NOT NULL, `service_id` VARCHAR(60) NOT NULL DEFAULT '',
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `category` VARCHAR(30) NOT NULL DEFAULT 'platform',
  `active` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE KEY `uq_ks_service` (`service_id`),
  INDEX `idx_ks_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
