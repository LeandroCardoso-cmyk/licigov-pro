-- Sprint 2.5: Document Retention & Legal Hold
-- Política de retenção LGPD-aligned, Lei 14.133/2021 compliant.

ALTER TABLE `documents` ADD COLUMN `retentionClass` varchar(50)  NOT NULL DEFAULT 'operational_3years' AFTER `snapshotFingerprint`;
ALTER TABLE `documents` ADD COLUMN `legalHold`      int          NOT NULL DEFAULT 0                    AFTER `retentionClass`;
ALTER TABLE `documents` ADD COLUMN `purgeAfter`     timestamp    NULL                                  AFTER `legalHold`;

CREATE INDEX `idx_docs_retention` ON `documents` (`retentionClass`, `purgeAfter`);
CREATE INDEX `idx_docs_legal_hold` ON `documents` (`legalHold`);
