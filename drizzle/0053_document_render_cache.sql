-- Sprint 2.5: Document Render Cache
-- Cache de renders por versão, formato e hash. TTL 24h.

CREATE TABLE `document_render_cache` (
  `id`              int AUTO_INCREMENT PRIMARY KEY,
  `organizationId`  int NOT NULL,
  `documentId`      int NOT NULL,
  `versionId`       int,
  `format`          enum('html','docx','pdf') NOT NULL,
  `renderHash`      varchar(32)    NOT NULL,
  `renderedContent` longtext,
  `renderedAt`      timestamp NULL,
  `expiresAt`       timestamp NULL,
  `status`          enum('pending','processing','ready','failed') NOT NULL DEFAULT 'pending',
  `storageKey`      varchar(500),
  `fileSize`        int,
  `errorMessage`    text,
  `createdAt`       timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX `idx_render_cache_key` ON `document_render_cache` (`documentId`, `format`, `renderHash`);
CREATE INDEX `idx_render_cache_doc`  ON `document_render_cache` (`documentId`, `organizationId`);
CREATE INDEX `idx_render_cache_exp`  ON `document_render_cache` (`expiresAt`);
