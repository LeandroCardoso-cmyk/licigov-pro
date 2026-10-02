-- 0312 — R4 / PR-07 (SEM-004) + R4.3: ledger APPEND-ONLY de decisões institucionais.
--
-- Contrato: server/domain/institutionalDecision.ts e docs/architecture/INSTITUTIONAL_DECISION_CONTRACT.md.
--  - separa QUEM DECIDIU (autoridade declarada no ato: nome, cargo, data, referência) de QUEM REGISTROU
--    (recorded_by_user_id = usuário autenticado); nunca infere autoridade do registrador;
--  - revisão monotônica por assunto: UNIQUE(organization_id, subject_type, subject_id, revision) + superação
--    explícita (supersedes_decision_id); a decisão superada permanece (append-only — a aplicação nunca faz
--    UPDATE/DELETE nesta tabela);
--  - idempotência: UNIQUE(organization_id, idempotency_key) + request_hash (mesma chave + pedido diferente ⇒
--    CONFLICT na aplicação);
--  - authority_validation = 'NOT_VALIDATED_POLICY_PENDING': o sistema NÃO valida competência jurídica (insumo
--    jurídico R4.2 pendente). Nenhum default de resultado (outcome NOT NULL, sem DEFAULT).
--
-- Puramente ADITIVA: CREATE TABLE IF NOT EXISTS (replay-safe; reaplicar = no-op). Nenhum dado existente é lido,
-- copiado, alterado ou apagado — a tabela legada `ratifications` permanece como HISTÓRICO legível (sem backfill:
-- as linhas antigas não têm autoridade declarada, data ou referência do ato, e não serão fabricadas).
-- Tenant-scoped (organization_id NOT NULL em todas as chaves). Colação explícita utf8mb4_unicode_ci (padrão das
-- tabelas canônicas). ROLLBACK lógico: a tabela é nova; se o build anterior for reimplantado ela é ignorada.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutional_decisions` (
	`id` varchar(24) NOT NULL,
	`organization_id` int NOT NULL,
	`subject_type` varchar(48) NOT NULL,
	`subject_id` varchar(64) NOT NULL,
	`decision_type` varchar(48) NOT NULL,
	`outcome` varchar(48) NOT NULL,
	`revision` int NOT NULL,
	`supersedes_decision_id` varchar(24),
	`decided_by_name` varchar(255) NOT NULL,
	`decided_by_role` varchar(255) NOT NULL,
	`decided_by_user_id` int,
	`decided_at` varchar(10) NOT NULL,
	`basis_reference` varchar(500) NOT NULL,
	`reason` text NOT NULL,
	`evidence` text,
	`recorded_by_user_id` int NOT NULL,
	`authority_validation` varchar(40) NOT NULL DEFAULT 'NOT_VALIDATED_POLICY_PENDING',
	`correlation_id` varchar(64) NOT NULL DEFAULT '',
	`idempotency_key` varchar(128) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `institutional_decisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_idc_subject_revision` UNIQUE(`organization_id`,`subject_type`,`subject_id`,`revision`),
	CONSTRAINT `uq_idc_org_idempotency` UNIQUE(`organization_id`,`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
