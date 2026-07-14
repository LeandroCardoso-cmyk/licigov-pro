-- SPRINT 5.3.1 — consolidação: metadados auditáveis de minuta + origem do aditivo.
ALTER TABLE `contract_ws_documents` ADD COLUMN `metadata` TEXT NULL;
ALTER TABLE `contract_addenda` ADD COLUMN `request_origin` VARCHAR(30) NOT NULL DEFAULT 'contract_workspace';
