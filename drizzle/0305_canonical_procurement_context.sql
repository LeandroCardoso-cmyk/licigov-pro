-- 0305 — Contexto Canônico da Contratação: ledger APPEND-ONLY de afirmações de fato por processo.
--
-- Por que uma tabela nova (e só uma): fatos da necessidade informados por humanos — unidade demandante,
-- planejamento, itens da contratação e quantidade PREVISTA (plannedQuantity) — não têm lugar no schema
-- atual: procurement_processes só guarda número/objeto/responsável; intelligent_items.quantity é a
-- quantidade da COTAÇÃO (fonte ≠ necessidade); generated_documents guarda DOCUMENTOS (texto), não fatos
-- com proveniência por campo; process_timeline guarda eventos narrativos sem valor estruturado.
--
-- Puramente ADITIVA: nenhum ALTER em tabela existente, nenhum backfill, nenhum UPDATE/DELETE.
-- Tenant-scoped (organization_id em todas as linhas e nos índices). Idempotente por
-- (organization_id, dedup_key). Compatível com deploy rolling (código antigo ignora a tabela).
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS; índice guardado por INFORMATION_SCHEMA. MySQL 8.4 e MariaDB.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_context_facts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`path` varchar(120) NOT NULL,
	`value_json` text,
	`value_hash` varchar(16) NOT NULL,
	`source_type` varchar(30) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`source_version` varchar(64) NOT NULL,
	`status` varchar(20) NOT NULL,
	`actor_user_id` int,
	`basis_value_hash` varchar(16),
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`dedup_key` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_context_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_procurement_context_facts_dedup` UNIQUE(`organization_id`,`dedup_key`)
)
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0305_add_idx
--> statement-breakpoint
CREATE PROCEDURE licigov_0305_add_idx()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_context_facts'
          AND INDEX_NAME = 'idx_procurement_context_facts_scope') = 0 THEN
    CREATE INDEX `idx_procurement_context_facts_scope` ON `procurement_context_facts` (`organization_id`,`process_id`,`id`);
  END IF;
END
--> statement-breakpoint
CALL licigov_0305_add_idx()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0305_add_idx
