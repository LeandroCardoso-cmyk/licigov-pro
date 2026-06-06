CREATE TABLE IF NOT EXISTS `embedding_snapshots` (
  `id`               VARCHAR(20)  NOT NULL PRIMARY KEY,
  `organization_id`  INT          NOT NULL,
  `text_hash`        VARCHAR(64)  NOT NULL,
  `model`            VARCHAR(100) NOT NULL DEFAULT 'mock-embed-v1',
  `dimensions`       SMALLINT     NOT NULL DEFAULT 1536,
  `checksum`         VARCHAR(64)  NOT NULL,
  `vector_preview`   JSON         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `idx_es_org`       (`organization_id`),
  INDEX `idx_es_hash`      (`text_hash`),
  INDEX `idx_es_checksum`  (`checksum`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
