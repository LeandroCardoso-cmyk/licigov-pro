CREATE TABLE IF NOT EXISTS `deployment_validation_snapshots` (
  `id`               VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `deployment_id`    VARCHAR(64)   NOT NULL,
  `passed_count`     SMALLINT      NOT NULL DEFAULT 0,
  `warning_count`    SMALLINT      NOT NULL DEFAULT 0,
  `error_count`      SMALLINT      NOT NULL DEFAULT 0,
  `critical_count`   SMALLINT      NOT NULL DEFAULT 0,
  `overall_passed`   TINYINT(1)    NOT NULL DEFAULT 0,
  `replay_key`       VARCHAR(64)   NOT NULL,
  `generated_at`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_dvs_replay`  (`replay_key`),
  INDEX `idx_dvs_org`            (`organization_id`),
  INDEX `idx_dvs_dep`            (`deployment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `validation_checks` (
  `id`               VARCHAR(64)   NOT NULL,
  `snapshot_id`      VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `name`             VARCHAR(255)  NOT NULL,
  `category`         ENUM('schema','tenant','workflow','migration','rollback','environment','readiness') NOT NULL,
  `passed`           TINYINT(1)    NOT NULL DEFAULT 0,
  `severity`         ENUM('info','warning','error','critical') NOT NULL DEFAULT 'info',
  `message`          TEXT          NOT NULL,
  `details`          JSON          NULL,
  `checked_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_vc_snapshot` (`snapshot_id`),
  INDEX `idx_vc_org`      (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;