-- Sprint 2.9 — Extraction Evidence
-- Cadeia de evidências de transformação de cada item (rastreabilidade jurídica).

CREATE TABLE IF NOT EXISTS extraction_evidence (
  id               VARCHAR(26)  NOT NULL,
  staging_item_id  VARCHAR(26)  NOT NULL UNIQUE,
  import_session_id INT         NOT NULL,
  organization_id  INT          NOT NULL,

  -- Provenance snapshot
  provenance_sheet VARCHAR(128) NULL,
  provenance_page  SMALLINT     NULL,
  provenance_row   INT          NULL,
  provenance_col   VARCHAR(32)  NULL,

  -- Evidence chain serializado como JSON (EvidenceEntry[])
  chain            JSON         NOT NULL DEFAULT (JSON_ARRAY()),

  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE INDEX idx_ee_staging_item (staging_item_id),
  INDEX idx_ee_session   (import_session_id),
  INDEX idx_ee_org       (organization_id),
  INDEX idx_ee_updated   (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
