ALTER TABLE `proposal_requests` ADD `empenhoFileUrl` text;--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `empenhoFileKey` varchar(255);--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `contratoFileUrl` text;--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `contratoFileKey` varchar(255);--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `dataAssinatura` timestamp;--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `dataInicioVigencia` timestamp;--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `dataFimVigencia` timestamp;--> statement-breakpoint
ALTER TABLE `proposal_requests` ADD `statusVigencia` enum('vigente','vence_30_dias','vence_60_dias','vence_90_dias','vencido') DEFAULT 'vigente';