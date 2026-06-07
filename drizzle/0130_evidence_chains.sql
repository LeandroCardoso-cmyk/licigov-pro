CREATE TABLE IF NOT EXISTS `evidence_chains` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `chain_type`       VARCHAR(50)  NOT NULL,
  `head_evidence_id` VARCHAR(100) NOT NULL,
  `links`            JSON         NULL,
  `total_links`      INT          NOT NULL DEFAULT 0,
  `confidence`       DECIMAL(4,3) NOT NULL DEFAULT 0,
  `provenance`       JSON         NULL,
  `is_superseded`    TINYINT(1)   NOT NULL DEFAULT 0,
  `superseded_by`    VARCHAR(20)  NULL,
  `lineage`          JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_ec_org`       (`organization_id`),
  INDEX `idx_ec_type`      (`organization_id`, `chain_type`),
  INDEX `idx_ec_head`      (`organization_id`, `head_evidence_id`),
  INDEX `idx_ec_superseded` (`organization_id`, `is_superseded`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
