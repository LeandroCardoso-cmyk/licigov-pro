-- 0306 — Itens da Contratação: Item Canônico (id ESTÁVEL), Lote (opcional), vínculos de fonte e ledger de eventos.
--
-- Por que tabelas relacionais (e não só o ledger de fatos da 0305): itens e lotes são ENTIDADES operacionais com
-- identidade estável, ordem oficial, pertencimento a lote (estado estrutural), status (ativo/retirado; lote
-- ativo/arquivado) e concorrência otimista (revision) — serializá-los como fatos tornaria ordem, movimentação
-- de lote e deduplicação de fontes frágeis. A quantidade PREVISTA continua SÓ no ledger 0305
-- (items.<id>.plannedQuantity): nenhuma fonte paralela de quantidade. intelligent_items NÃO é reutilizado como
-- item da contratação: sua `quantity` é a da COTAÇÃO e compõe sua identidade (fonte ≠ necessidade).
--
--  - procurement_items:              Item Canônico (descrição/unidade confirmadas, lote, ordem, status, proveniência).
--  - procurement_lots:               Lote (código único por processo, ordem, status; nunca hard-delete).
--  - procurement_item_source_links:  evidência de fonte → item (Pesquisa/DFD); UNIQUE por evidência ⇒ reprocessar
--                                    ou clicar duas vezes NUNCA duplica.
--  - procurement_item_events:        ledger APPEND-ONLY de auditoria (hashes antes/depois, sem conteúdo integral).
--
-- Puramente ADITIVA: nenhum ALTER em tabela existente, nenhum backfill, nenhum UPDATE/DELETE. Tenant-scoped
-- (organization_id em todas as linhas e índices). Compatível com deploy rolling (código antigo ignora as tabelas).
-- Sem FK física (convenção do repositório: escopo por organização aplicado na aplicação + índices).
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS; índices guardados por INFORMATION_SCHEMA. MySQL 8.4 e MariaDB.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_item_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`item_id` varchar(24),
	`lot_id` varchar(24),
	`event_type` varchar(50) NOT NULL,
	`actor_user_id` int NOT NULL,
	`before_hash` varchar(16),
	`after_hash` varchar(16),
	`source` varchar(40),
	`reason` varchar(500),
	`details_json` text,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_item_events_id` PRIMARY KEY(`id`)
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_item_source_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`item_id` varchar(24) NOT NULL,
	`source_type` varchar(30) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`source_item_key` varchar(64) NOT NULL,
	`source_digest` varchar(32) NOT NULL,
	`source_quantity` decimal(14,3),
	`source_description` text NOT NULL,
	`source_unit` varchar(30) NOT NULL,
	`source_lot_code` varchar(40),
	`created_by` int NOT NULL,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_item_source_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pitem_links_source` UNIQUE(`organization_id`,`process_id`,`source_type`,`source_id`,`source_item_key`)
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_items` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`description` text NOT NULL,
	`unit` varchar(30) NOT NULL,
	`lot_id` varchar(24),
	`ordinal` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`fingerprint` varchar(16) NOT NULL,
	`origin` varchar(20) NOT NULL,
	`provenance_json` text NOT NULL,
	`withdrawn_reason` varchar(500),
	`revision` int NOT NULL DEFAULT 1,
	`created_by` int NOT NULL,
	`updated_by` int NOT NULL,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_items_id` PRIMARY KEY(`id`)
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_lots` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`process_id` varchar(20) NOT NULL,
	`code` varchar(40) NOT NULL,
	`code_key` varchar(40) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`ordinal` int NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`created_by` int NOT NULL,
	`updated_by` int NOT NULL,
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `procurement_lots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_procurement_lots_code` UNIQUE(`organization_id`,`process_id`,`code_key`)
)
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0306_add_idx
--> statement-breakpoint
CREATE PROCEDURE licigov_0306_add_idx(IN p_tbl VARCHAR(64), IN p_idx VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND INDEX_NAME = p_idx) = 0 THEN
    SET @licigov_0306_ddl = CONCAT('CREATE INDEX `', p_idx, '` ON `', p_tbl, '` (', p_cols, ')');
    PREPARE licigov_0306_stmt FROM @licigov_0306_ddl;
    EXECUTE licigov_0306_stmt;
    DEALLOCATE PREPARE licigov_0306_stmt;
  END IF;
END
--> statement-breakpoint
CALL licigov_0306_add_idx('procurement_item_events','idx_pitem_events_scope','`organization_id`,`process_id`,`id`')
--> statement-breakpoint
CALL licigov_0306_add_idx('procurement_item_source_links','idx_pitem_links_item','`organization_id`,`process_id`,`item_id`')
--> statement-breakpoint
CALL licigov_0306_add_idx('procurement_items','idx_procurement_items_scope','`organization_id`,`process_id`,`ordinal`')
--> statement-breakpoint
CALL licigov_0306_add_idx('procurement_items','idx_procurement_items_fingerprint','`organization_id`,`process_id`,`fingerprint`')
--> statement-breakpoint
CALL licigov_0306_add_idx('procurement_lots','idx_procurement_lots_scope','`organization_id`,`process_id`,`ordinal`')
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0306_add_idx
