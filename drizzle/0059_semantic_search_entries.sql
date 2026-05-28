-- Sprint 2.9 — Semantic Search Entries
-- Índice de busca semântica local (sem vetores/embeddings nesta versão).

CREATE TABLE IF NOT EXISTS semantic_search_entries (
  id               VARCHAR(26)   NOT NULL,
  organization_id  INT           NOT NULL,

  canonical_text   TEXT          NOT NULL,
  display_text     TEXT          NOT NULL,
  category         VARCHAR(128)  NULL,
  subcategory      VARCHAR(128)  NULL,

  tokens           JSON          NOT NULL DEFAULT (JSON_ARRAY()),
  aliases          JSON          NOT NULL DEFAULT (JSON_ARRAY()),
  synonym_tokens   JSON          NOT NULL DEFAULT (JSON_ARRAY()),

  frequency        INT           NOT NULL DEFAULT 0,
  last_seen_at     DATETIME(3)   NULL,
  source           ENUM('manual','learned','catmat','imported') NOT NULL DEFAULT 'manual',

  catmat_code      VARCHAR(20)   NULL,
  catmat_group     VARCHAR(128)  NULL,
  catmat_class     VARCHAR(128)  NULL,

  is_active        TINYINT(1)    NOT NULL DEFAULT 1,

  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  INDEX idx_sse_org         (organization_id),
  INDEX idx_sse_catmat      (catmat_code),
  INDEX idx_sse_source      (source),
  INDEX idx_sse_frequency   (frequency DESC),
  INDEX idx_sse_active      (is_active),
  FULLTEXT INDEX ft_sse_canonical (canonical_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
