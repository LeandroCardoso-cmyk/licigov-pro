-- Sprint 2.5: Document Integrity — Anti-tampering hashes
-- SHA-256 de conteúdo + fingerprint de snapshot para documentos e versões.

ALTER TABLE `documents` ADD COLUMN `contentHash`         varchar(64) AFTER `archivedAt`;
ALTER TABLE `documents` ADD COLUMN `snapshotFingerprint` varchar(64) AFTER `contentHash`;

ALTER TABLE `document_versions` ADD COLUMN `snapshotFingerprint` varchar(64) AFTER `correlationId`;
