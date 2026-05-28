-- Sprint 2.9 — Parser Capabilities
-- Registro de capacidades e limitações de cada parser (auditável, versionado).

CREATE TABLE IF NOT EXISTS parser_capabilities (
  id                            VARCHAR(26)  NOT NULL,
  parser_type                   ENUM('xlsx','xls','csv','docx','pdf','auto') NOT NULL,
  parser_version                VARCHAR(20)  NOT NULL,

  supports_multi_sheet          TINYINT(1)   NOT NULL DEFAULT 0,
  supports_multi_page           TINYINT(1)   NOT NULL DEFAULT 0,
  supports_formulas             TINYINT(1)   NOT NULL DEFAULT 0,
  supports_merged_cells         TINYINT(1)   NOT NULL DEFAULT 0,
  supports_images               TINYINT(1)   NOT NULL DEFAULT 0,
  supports_headers              TINYINT(1)   NOT NULL DEFAULT 1,
  supports_footers              TINYINT(1)   NOT NULL DEFAULT 0,

  description_confidence        DECIMAL(4,3) NOT NULL,
  quantity_confidence           DECIMAL(4,3) NOT NULL,
  unit_confidence               DECIMAL(4,3) NOT NULL,
  price_confidence              DECIMAL(4,3) NOT NULL,

  limitations                   JSON         NULL,

  requires_manual_unit_review   TINYINT(1)   NOT NULL DEFAULT 0,
  requires_manual_price_review  TINYINT(1)   NOT NULL DEFAULT 0,
  likelihood_merged_headers     DECIMAL(4,3) NOT NULL DEFAULT 0,
  likelihood_footer_rows        DECIMAL(4,3) NOT NULL DEFAULT 0,

  registered_at                 DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE INDEX idx_pc_type_version (parser_type, parser_version),
  INDEX idx_pc_type (parser_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
