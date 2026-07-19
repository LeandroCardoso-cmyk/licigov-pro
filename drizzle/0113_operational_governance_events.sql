CREATE TABLE IF NOT EXISTS `governance_policies` (
  `id`               VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `policy_type`      ENUM('deployment','workflow','escalation','approval','data_access','support','incident','sla') NOT NULL,
  `name`             VARCHAR(255)  NOT NULL,
  `description`      TEXT          NULL,
  `rules`            JSON          NOT NULL,
  `is_active`        TINYINT(1)    NOT NULL DEFAULT 1,
  `effective_from`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effective_to`     DATETIME(3)   NULL,
  `created_by`       INT           NOT NULL,
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_gp_org`    (`organization_id`),
  INDEX `idx_gp_type`   (`organization_id`, `policy_type`),
  INDEX `idx_gp_active` (`organization_id`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `governance_events` (
  `id`               VARCHAR(64)   NOT NULL,
  `policy_id`        VARCHAR(64)   NOT NULL,
  `organization_id`  INT           NOT NULL,
  `action`           ENUM('create_policy','enforce_policy','waive_policy','audit_policy','expire_policy','renew_policy') NOT NULL,
  `actor`            INT           NOT NULL,
  `context`          JSON          NULL,
  `outcome`          ENUM('compliant','non_compliant','waived','escalated') NOT NULL,
  `justification`    TEXT          NULL,
  `occurred_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_ge_org`    (`organization_id`),
  INDEX `idx_ge_policy` (`policy_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;