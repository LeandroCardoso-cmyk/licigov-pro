-- Sprint 2.9 — Semantic Candidates
-- Candidatos de normalização semântica gerados pelo pipeline.

CREATE TABLE IF NOT EXISTS semantic_candidates (
  id                    VARCHAR(26)  NOT NULL,
  staging_item_id       VARCHAR(26)  NOT NULL,
  import_session_id     INT          NOT NULL,
  organization_id       INT          NOT NULL,

  proposed_description  TEXT         NOT NULL,
  proposed_unit         VARCHAR(50)  NULL,
  proposed_quantity     DECIMAL(15,4) NULL,
  proposed_unit_price   DECIMAL(15,4) NULL,

  score                 DECIMAL(5,4) NOT NULL,
  `rank`                TINYINT      NOT NULL DEFAULT 1,
  source                ENUM(
    'exact_match','alias_match','fuzzy_match','prefix_match',
    'token_match','ngram_match','rule_based','catmat_lookup'
  ) NOT NULL,
  status                ENUM('pending','accepted','rejected','superseded','expired') NOT NULL DEFAULT 'pending',

  explanation_reason    TEXT         NULL,
  explanation_matched   JSON         NULL,
  explanation_penalty   DECIMAL(4,3) NULL DEFAULT 0,
  explanation_bonus     DECIMAL(4,3) NULL DEFAULT 0,

  original_raw          TEXT         NOT NULL,
  catmat_code           VARCHAR(20)  NULL,
  catmat_desc           TEXT         NULL,
  catmat_group          VARCHAR(128) NULL,
  index_entry_id        VARCHAR(26)  NULL,

  generated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  evaluated_at          DATETIME(3)  NULL,
  evaluated_by          INT          NULL,

  PRIMARY KEY (id),
  INDEX idx_sc_staging_item   (staging_item_id),
  INDEX idx_sc_session        (import_session_id),
  INDEX idx_sc_org            (organization_id),
  INDEX idx_sc_status         (status),
  INDEX idx_sc_score          (score DESC),
  INDEX idx_sc_catmat         (catmat_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
