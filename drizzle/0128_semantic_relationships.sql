CREATE TABLE IF NOT EXISTS `semantic_relationships` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `source_node_id`   VARCHAR(100) NOT NULL,
  `source_type`      VARCHAR(50)  NOT NULL,
  `target_node_id`   VARCHAR(100) NOT NULL,
  `target_type`      VARCHAR(50)  NOT NULL,
  `edge_type`        VARCHAR(50)  NOT NULL,
  `weight`           DECIMAL(6,5) NOT NULL DEFAULT 1,
  `propagated_score` DECIMAL(6,5) NULL,
  `hop_distance`     INT          NOT NULL DEFAULT 0,
  `metadata`         JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_sr_org`    (`organization_id`),
  INDEX `idx_sr_source` (`organization_id`, `source_node_id`),
  INDEX `idx_sr_target` (`organization_id`, `target_node_id`),
  INDEX `idx_sr_type`   (`organization_id`, `edge_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
