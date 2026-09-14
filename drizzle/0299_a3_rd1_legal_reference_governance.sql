-- 0299 — A3-RD1: GOVERNED LEGAL REFERENCE DATA (Lei 14.133/2021).
--
-- Cria o dominio GOVERNADO de referencia juridica (F-LEGAL1.1/F-LEGAL1.2), ADITIVO e SEPARADO do
-- legado `direct_contract_legal_articles` (que permanece intacto para consumidores antigos):
--   * legal_reference_sets        -> conjunto VERSIONADO e aprovavel (status draft|active|superseded)
--   * legal_reference_entries     -> norma ESTRUTURAL imutavel (vigencia deriva do set)
--   * legal_value_overrides       -> VALOR temporal desacoplado da norma
--   * legal_reference_set_events  -> auditoria APPEND-ONLY do lifecycle
--
-- Escopo GLOBAL/BR-FEDERAL (governanca de plataforma; NAO pertence a tenant). Puramente ADITIVA:
-- CREATE TABLE IF NOT EXISTS -> idempotente e portavel (MySQL 8 e MariaDB); clean install cria, banco
-- convergido no-op. NAO altera/remove nada existente. NAO instala dados: a instalacao do reference set
-- e um passo SEPARADO e replay-safe do release; instalar != ativar (set nasce draft).
CREATE TABLE IF NOT EXISTS `legal_reference_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`law` varchar(50) NOT NULL,
	`jurisdiction` varchar(30) NOT NULL,
	`scope` varchar(20) NOT NULL,
	`version` int NOT NULL,
	`status` enum('draft','active','superseded') NOT NULL DEFAULT 'draft',
	`coverage_manifest` json NOT NULL,
	`coverage_manifest_hash` varchar(64) NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`effective_from` varchar(10) NOT NULL,
	`effective_to` varchar(10),
	`source_authority` varchar(120),
	`source_identifier` varchar(200),
	`verification_method` varchar(60),
	`approved_by_user_id` int,
	`approved_at` timestamp NULL,
	`approval_source` varchar(60),
	`approved_reference_hash` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `legal_reference_sets_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_reference_sets_law_jur_ver_unique` UNIQUE(`law`,`jurisdiction`,`version`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legal_reference_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`set_id` int NOT NULL,
	`law` varchar(50) NOT NULL,
	`article` varchar(20) NOT NULL,
	`inciso` varchar(10),
	`alinea` varchar(10),
	`canonical_locator` varchar(120) NOT NULL,
	`canonical_display` varchar(40) NOT NULL,
	`procurement_type` enum('dispensa','inexigibilidade') NOT NULL,
	`hypothesis_summary` varchar(1000) NOT NULL,
	`source_authority` varchar(120) NOT NULL,
	`source_identifier` varchar(200) NOT NULL,
	`source_url` varchar(500) NOT NULL,
	`publication_date` varchar(10),
	`content_hash` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `legal_reference_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_reference_entries_set_locator_unique` UNIQUE(`set_id`,`canonical_locator`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legal_value_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`set_id` int NOT NULL,
	`canonical_locator` varchar(120) NOT NULL,
	`value_cents` int NOT NULL,
	`effective_from` varchar(10) NOT NULL,
	`effective_to` varchar(10),
	`source_authority` varchar(120) NOT NULL,
	`source_identifier` varchar(200) NOT NULL,
	`source_url` varchar(500) NOT NULL,
	`publication_date` varchar(10),
	`content_hash` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `legal_value_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_value_overrides_set_locator_from_unique` UNIQUE(`set_id`,`canonical_locator`,`effective_from`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `legal_reference_set_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`set_id` int NOT NULL,
	`action` varchar(30) NOT NULL,
	`from_status` varchar(20),
	`to_status` varchar(20),
	`actor_user_id` int,
	`actor_role` varchar(40),
	`correlation_id` varchar(64),
	`approved_reference_hash` varchar(64),
	`details` json,
	`occurred_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `legal_reference_set_events_id` PRIMARY KEY(`id`)
);
