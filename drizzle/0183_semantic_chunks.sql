-- Re-fundação da tabela (fase RC posterior): em cadeia zerada a versão anterior
-- (vazia) é substituída pela forma canônica do schema.ts. Bancos existentes nunca
-- re-executam migrations antigas (decisão por timestamp do journal).
DROP TABLE IF EXISTS `semantic_chunks`;
--> statement-breakpoint
CREATE TABLE `semantic_chunks` (
  `id` VARCHAR(20) NOT NULL,
  `organization_id` INT NOT NULL,
  `document_id` VARCHAR(255) NOT NULL,
  `source_type` ENUM('document','legal_text','jurisprudence','template','manual_entry') NOT NULL DEFAULT 'document',
  `source_snapshot_id` VARCHAR(64) NULL,
  `chunk_index` INT NOT NULL DEFAULT 0,
  `chunk_hash` VARCHAR(64) NOT NULL,
  `chunk_text` TEXT NULL,
  `normalized_text` TEXT NULL,
  `semantic_metadata` JSON NULL,
  `chunk_strategy` ENUM('paragraph_chunking','semantic_chunking','sliding_window','hierarchical_chunking','legal_clause_chunking') NOT NULL DEFAULT 'paragraph_chunking',
  `token_count` INT NOT NULL DEFAULT 0,
  `language` VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_sc_org` (`organization_id`),
  INDEX `idx_sc_doc` (`document_id`),
  INDEX `idx_sc_hash` (`chunk_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
