-- 0298 — V1 PRE-PILOT CLOSURE — Fase A1: COGNITIVE PROVENANCE, DEGRADED STATE & REPLAY CONTRACT.
--
-- Cria o ledger IMUTAVEL de proveniencia cognitiva (cognitive_provenance) e faz um BACKFILL
-- CLASSIFICATORIO/FACTUAL/REPLAY-SAFE dos registros historicos (pre-provenance) a partir de
-- cognitive_observability, marcando-os como legacy_unclassified SEM fabricar provider/model/
-- evidence/deterministic (canonical semantic: provenance_class=legacy_unclassified,
-- grounding_state=legacy_unclassified, provider/model NULL, fingerprints nao computados).
--
-- Migration NOVA (idx 298): roda UMA vez em cada banco (incluindo producao). Puramente ADITIVA:
--   * CREATE TABLE IF NOT EXISTS  -> idempotente e portavel (MySQL 8 e MariaDB); no clean install cria,
--     em banco ja convergido e no-op.
--   * INSERT IGNORE ... SELECT     -> backfill idempotente: reaplicar nao duplica (id deterministico
--     por observabilidade). NAO faz DROP, NAO perde dados, NAO altera nenhuma coluna existente.
CREATE TABLE IF NOT EXISTS `cognitive_provenance` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`execution_id` varchar(20) NOT NULL DEFAULT '',
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`task` varchar(60) NOT NULL DEFAULT '',
	`execution_mode` varchar(20) NOT NULL DEFAULT 'cognitive',
	`execution_status` varchar(24) NOT NULL DEFAULT 'completed',
	`degradation_reason` varchar(40),
	`failure_class` varchar(40),
	`grounding_state` varchar(24) NOT NULL DEFAULT 'not_applicable',
	`provenance_class` varchar(24) NOT NULL DEFAULT 'provenanced',
	`provider` varchar(40),
	`model` varchar(80),
	`task_version` varchar(20) NOT NULL DEFAULT '',
	`prompt_contract_version` varchar(40) NOT NULL DEFAULT '',
	`orchestrator_version` varchar(20) NOT NULL DEFAULT '',
	`input_fingerprint` varchar(64) NOT NULL DEFAULT '',
	`output_fingerprint` varchar(64),
	`evidence_fingerprint` varchar(64),
	`replay_hash` varchar(64) NOT NULL DEFAULT '',
	`idempotency_key` varchar(255),
	`is_replay` int NOT NULL DEFAULT 0,
	`replay_of_execution_id` varchar(20),
	`approval_state` varchar(40) NOT NULL DEFAULT 'generated',
	`artifact_kind` varchar(20),
	`artifact_id` varchar(20),
	`official_document_id` varchar(20),
	`official_lineage_id` varchar(20),
	`business_domain` varchar(50),
	`process_id` varchar(20),
	`workspace_id` varchar(60),
	`stage` varchar(60),
	`actor_user_id` varchar(60),
	`failure_message` varchar(300),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `cognitive_provenance_id` PRIMARY KEY(`id`),
	KEY `idx_cognitive_provenance_exec` (`organization_id`,`execution_id`),
	KEY `idx_cognitive_provenance_corr` (`organization_id`,`correlation_id`),
	KEY `idx_cognitive_provenance_idem` (`organization_id`,`idempotency_key`),
	KEY `idx_cognitive_provenance_artifact` (`organization_id`,`artifact_kind`,`artifact_id`),
	KEY `idx_cognitive_provenance_created` (`organization_id`,`created_at`)
);
--> statement-breakpoint
-- BACKFILL historico (pre-provenance) — classificatorio, factual, replay-safe. cognitive_observability
-- e criada por migration anterior (0283) na cadeia, entao existe aqui em qualquer banco. INSERT IGNORE
-- torna a operacao idempotente (id deterministico 'leg' + LEFT(id,21) = 24 chars, nunca colide com o id
-- de runtime, que e sha256 puro). NAO fabrica provider/model/evidence/grounding; NAO marca deterministic.
INSERT IGNORE INTO `cognitive_provenance`
	(`id`, `organization_id`, `execution_id`, `correlation_id`, `task`,
	 `execution_mode`, `execution_status`, `grounding_state`, `provenance_class`,
	 `provider`, `model`, `input_fingerprint`, `replay_hash`, `is_replay`,
	 `approval_state`, `orchestrator_version`, `created_at`)
SELECT
	CONCAT('leg', LEFT(`id`, 21)),
	`tenant_id`,
	`id`,
	`correlation_id`,
	LEFT(`task`, 60),
	'cognitive',
	CASE WHEN `execution_status` IN ('failed', 'invalid') THEN 'failed' ELSE 'completed' END,
	'legacy_unclassified',
	'legacy_unclassified',
	NULL,
	NULL,
	'',
	LEFT(`replay_hash`, 64),
	0,
	'generated',
	'legacy',
	`created_at`
FROM `cognitive_observability`;
