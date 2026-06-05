CREATE TABLE IF NOT EXISTS `support_escalations` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `incident_id`      VARCHAR(64)  NOT NULL,
  `escalation_level` TINYINT      NOT NULL DEFAULT 1,
  `escalated_to`     VARCHAR(255) NOT NULL,
  `reason`           TEXT         NOT NULL,
  `status`           ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  `escalated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_at`      DATETIME(3)  NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_se_org`      (`organization_id`),
  INDEX `idx_se_incident` (`incident_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `incident_correlations` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `incident_id`      VARCHAR(64)  NOT NULL,
  `correlation_id`   VARCHAR(64)  NOT NULL,
  `impact_scope`     ENUM('single_user','department','organization','system_wide') NOT NULL DEFAULT 'single_user',
  `impact_score`     SMALLINT     NOT NULL DEFAULT 0,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ic_org`         (`organization_id`),
  INDEX `idx_ic_correlation` (`correlation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
