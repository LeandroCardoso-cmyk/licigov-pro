CREATE TABLE `feature_flags` (
  `name` varchar(100) NOT NULL PRIMARY KEY,
  `enabled` boolean NOT NULL DEFAULT false,
  `reason` varchar(255),
  `updatedBy` int,
  `updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now()
);

CREATE TABLE `tenant_feature_flags` (
  `organizationId` int NOT NULL,
  `flagName` varchar(100) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `percentage` int DEFAULT 100,
  `expiresAt` timestamp NULL,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (`organizationId`, `flagName`),
  INDEX `idx_tenant_flags_name` (`flagName`)
);

-- Feature flags operacionais padrão (todos desabilitados por padrão)
INSERT INTO `feature_flags` (`name`, `enabled`, `reason`) VALUES
  ('FF_IA_GLOBAL_DISABLE',        false, 'Desabilitar globalmente todas as operações de IA'),
  ('FF_CATMAT_SYNC_DISABLE',      false, 'Pausar sincronização do catálogo CATMAT'),
  ('FF_AUTOSAVE_SERVER_DISABLE',  false, 'Desabilitar autosave server-side'),
  ('FF_UPLOAD_DISABLE',           false, 'Desabilitar uploads de arquivo'),
  ('FF_STRICT_WORKFLOW',          false, 'Habilitar validação estrita de workflow'),
  ('FF_NEW_IMPORTER',             false, 'Novo importador de TR (beta)'),
  ('FF_OUTBOX_DISPATCHER_PAUSE',  false, 'Pausar dispatcher do outbox');
