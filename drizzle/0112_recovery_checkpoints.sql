CREATE TABLE IF NOT EXISTS `recovery_checkpoints` (
  `id`               VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `checkpoint_type`  ENUM('pre_deployment','post_migration','manual','scheduled','pre_rollback') NOT NULL,
  `snapshot_data`    JSON          NOT NULL,
  `integrity_hash`   VARCHAR(64)   NOT NULL,
  `is_valid`         TINYINT(1)    NOT NULL DEFAULT 1,
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rc_org`  (`organization_id`),
  INDEX `idx_rc_type` (`organization_id`, `checkpoint_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recovery_plans` (
  `id`                    VARCHAR(64)   NOT NULL,
  `organization_id`       INT           NOT NULL,
  `checkpoint_id`         VARCHAR(64)   NOT NULL,
  `plan_type`             ENUM('rollback','restore','partial_restore','tenant_restore') NOT NULL,
  `steps`                 JSON          NOT NULL,
  `estimated_duration_ms` INT           NOT NULL DEFAULT 0,
  `risk_level`            ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `validated_at`          DATETIME(3)   NULL,
  `created_at`            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rp_org`  (`organization_id`),
  INDEX `idx_rp_cp`   (`checkpoint_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recovery_logs` (
  `id`               VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `plan_id`          VARCHAR(64)   NOT NULL,
  `step`             SMALLINT      NOT NULL,
  `outcome`          ENUM('success','failed','skipped') NOT NULL,
  `notes`            TEXT          NULL,
  `executed_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_rl_org`  (`organization_id`),
  INDEX `idx_rl_plan` (`plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;