CREATE TABLE `embedding_jobs` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `corpus_id` VARCHAR(20) NOT NULL,
  `provider_id` VARCHAR(255) NOT NULL,
  `model` VARCHAR(255) NOT NULL,
  `total_chunks` INT NOT NULL DEFAULT 0,
  `processed_chunks` INT NOT NULL DEFAULT 0,
  `failed_chunks` INT NOT NULL DEFAULT 0,
  `status` ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  `correlation_id` VARCHAR(64) NOT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ej_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
