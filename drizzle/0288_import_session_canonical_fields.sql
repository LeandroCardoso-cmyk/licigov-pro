-- 0288 — PR B.2.1: campos canônicos de ingestão em `import_sessions`.
-- Migration ADITIVA e versionada. Colunas NULLABLE (compatibilidade com linhas históricas;
-- sem backfill especulativo). checksum = sha256 calculado pelo SERVIDOR (valor do cliente é
-- apenas expectativa a validar). processId = vínculo/lineage com o processo (ownership
-- validado no serviço por processId + organizationId). importPurpose = finalidade da importação.
-- Índice tenant-aware NÃO-único: o mesmo checksum reaparece em re-import legítimo (após
-- rejeição/arquivamento) — nenhuma unicidade global apenas por checksum.
ALTER TABLE `import_sessions` ADD `checksum` varchar(64);
--> statement-breakpoint
ALTER TABLE `import_sessions` ADD `processId` int;
--> statement-breakpoint
ALTER TABLE `import_sessions` ADD `importPurpose` varchar(50);
--> statement-breakpoint
ALTER TABLE `import_sessions` ADD INDEX `import_sessions_org_checksum_idx` (`organizationId`,`checksum`);
