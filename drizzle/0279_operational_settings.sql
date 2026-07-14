CREATE TABLE IF NOT EXISTS `operational_settings` (
  `id` VARCHAR(20) NOT NULL, `organization_id` INT NOT NULL,
  `orgao_oficial_name` VARCHAR(255) NOT NULL DEFAULT 'Órgão Oficial do Município',
  `jornal_name` VARCHAR(255) NOT NULL DEFAULT 'Jornal de Grande Circulação',
  `portal_name` VARCHAR(255) NOT NULL DEFAULT 'Portal Eletrônico',
  `correlation_id` VARCHAR(64) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `idx_opset_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
