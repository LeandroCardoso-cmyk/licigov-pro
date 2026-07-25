-- 0287 — PR A.1: acesso institucional (convites, recuperação de senha, outbox de e-mail).
-- Puramente aditiva e idempotente (CREATE TABLE IF NOT EXISTS, com os índices declarados inline
-- para que reexecutar a migration não falhe — MySQL não tem CREATE INDEX IF NOT EXISTS).
--
-- As mudanças em `users` (coluna `tokenVersion` e índice UNIQUE em `email`) NÃO entram aqui:
-- pela regra do projeto (ver cabeçalho da 0285), alterações em tabelas preexistentes vão para o
-- ensureSchema (server/bootstrap.ts), que é idempotente e roda em todo boot. No caso do UNIQUE de
-- e-mail isso é também uma proteção: o ensureSchema só cria o índice depois de verificar que não
-- há duplicatas, evitando derrubar o boot de um ambiente com dados legados
-- (procedimento de saneamento em docs/ops/EMAIL_BREVO_RUNBOOK.md).
CREATE TABLE IF NOT EXISTS `institutional_invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`role` enum('owner','admin','manager','operator','viewer') NOT NULL DEFAULT 'operator',
	`status` enum('pending','accepted','expired','cancelled','superseded') NOT NULL DEFAULT 'pending',
	`tokenHash` varchar(64) NOT NULL,
	`activeKey` varchar(350),
	`invitedName` varchar(255),
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp NULL,
	`cancelledAt` timestamp NULL,
	`createdByUserId` int,
	`acceptedByUserId` int,
	`resendCount` int NOT NULL DEFAULT 0,
	`lastSentAt` timestamp NULL,
	`correlationId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `institutional_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `institutional_invitations_active_key` UNIQUE(`activeKey`),
	CONSTRAINT `institutional_invitations_token_hash` UNIQUE(`tokenHash`),
	INDEX `idx_invitations_org_status` (`organizationId`, `status`),
	INDEX `idx_invitations_expires` (`status`, `expiresAt`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp NULL,
	`revokedAt` timestamp NULL,
	`requestedAt` timestamp NOT NULL DEFAULT (now()),
	`ipAddress` varchar(45),
	`correlationId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_hash` UNIQUE(`tokenHash`),
	INDEX `idx_password_reset_user` (`userId`, `expiresAt`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_outbox` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`messageType` varchar(60) NOT NULL,
	`recipient` varchar(320) NOT NULL,
	`templateKey` varchar(60) NOT NULL,
	`payload` json NOT NULL,
	`idempotencyKey` varchar(190) NOT NULL,
	`status` enum('pending','processing','sent','retryable_failure','permanent_failure','cancelled') NOT NULL DEFAULT 'pending',
	`provider` varchar(40),
	`providerMessageId` varchar(255),
	`attempts` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 5,
	`nextAttemptAt` timestamp NULL,
	`sentAt` timestamp NULL,
	`failedAt` timestamp NULL,
	`lastErrorCode` varchar(60),
	`lastErrorMessage` varchar(500),
	`correlationId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_outbox_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_outbox_idempotency_key` UNIQUE(`idempotencyKey`),
	INDEX `idx_email_outbox_dispatch` (`status`, `nextAttemptAt`)
);
