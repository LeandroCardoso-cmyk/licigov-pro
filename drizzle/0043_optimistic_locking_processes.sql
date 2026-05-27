-- Sprint 1.8: Optimistic locking — version field em processes
-- documents.version já existe desde a migration 0001 (criação original da tabela)
ALTER TABLE `processes` ADD COLUMN `version` int NOT NULL DEFAULT 1;
