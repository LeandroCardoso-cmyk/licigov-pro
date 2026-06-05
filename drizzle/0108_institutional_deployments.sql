CREATE TABLE IF NOT EXISTS `institutional_deployments` (
  `id`                   VARCHAR(64)  NOT NULL,
  `organization_id`      INT          NOT NULL,
  `municipio`            VARCHAR(255) NOT NULL,
  `phase`                ENUM('planning','infrastructure_prep','data_migration','parallel_run','cutover','stabilization','full_operation') NOT NULL DEFAULT 'planning',
  `status`               ENUM('scheduled','in_progress','paused','completed','failed','rolled_back') NOT NULL DEFAULT 'scheduled',
  `target_version`       VARCHAR(50)  NOT NULL,
  `current_version`      VARCHAR(50)  NOT NULL,
  `rollout_percentage`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `health_score`         TINYINT UNSIGNED NOT NULL DEFAULT 100,
  `validation_results`   JSON         NULL,
  `rollback_point`       VARCHAR(64)  NULL,
  `activated_at`         DATETIME(3)  NULL,
  `completed_at`         DATETIME(3)  NULL,
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_id_org`     (`organization_id`),
  INDEX `idx_id_status`  (`organization_id`, `status`),
  INDEX `idx_id_phase`   (`organization_id`, `phase`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployment_governance` (
  `id`                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `deployment_id`          VARCHAR(64)  NOT NULL,
  `organization_id`        INT          NOT NULL,
  `approved_by`            INT          NOT NULL,
  `approval_justification` TEXT         NOT NULL,
  `constraints`            JSON         NULL,
  `governance_checks`      JSON         NULL,
  `governance_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_dg_org`       (`organization_id`),
  INDEX `idx_dg_dep`       (`deployment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `deployment_events` (
  `id`              VARCHAR(64)  NOT NULL,
  `deployment_id`   VARCHAR(64)  NOT NULL,
  `organization_id` INT          NOT NULL,
  `phase`           VARCHAR(50)  NOT NULL,
  `event_type`      VARCHAR(50)  NOT NULL,
  `actor`           VARCHAR(255) NOT NULL,
  `notes`           TEXT         NULL,
  `occurred_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_de_org` (`organization_id`),
  INDEX `idx_de_dep` (`deployment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
