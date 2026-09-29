-- Agenda opcional dos registros operacionais já existentes. Colunas vazias preservam
-- o significado anterior; nenhum dado histórico recebe uma data presumida.
--> statement-breakpoint
ALTER TABLE `operation_records`
  ADD COLUMN `event_date` varchar(10) NOT NULL DEFAULT '',
  ADD COLUMN `event_end_date` varchar(10) NOT NULL DEFAULT '',
  ADD COLUMN `event_time` varchar(5) NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX `idx_oprec_calendar` ON `operation_records` (`organization_id`, `event_date`, `event_end_date`);
