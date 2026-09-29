-- Ciclo de vida operacional dos registros do Centro de Operações. `active` preserva o
-- comportamento anterior para todos os registros existentes; nenhuma linha é removida e a
-- agenda permanece intacta. Concluir/reabrir é uma transição auditada na timeline.
--> statement-breakpoint
ALTER TABLE `operation_records`
  ADD COLUMN `lifecycle_status` varchar(12) NOT NULL DEFAULT 'active',
  ADD COLUMN `completed_at` datetime(3) NULL,
  ADD COLUMN `completed_by` int NULL,
  ADD COLUMN `completion_reason` text NULL;
--> statement-breakpoint
CREATE INDEX `idx_oprec_lifecycle` ON `operation_records` (`organization_id`, `lifecycle_status`);
