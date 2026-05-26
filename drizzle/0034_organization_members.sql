CREATE TABLE `organization_members` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `organizationId` int NOT NULL,
  `userId` int NOT NULL,
  `role` enum('owner','admin','manager','operator','viewer') NOT NULL DEFAULT 'operator',
  `invitedBy` int,
  `ativo` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT now(),
  `updatedAt` timestamp NOT NULL DEFAULT now() ON UPDATE now(),
  UNIQUE KEY `org_members_org_user_unique` (`organizationId`, `userId`),
  INDEX `idx_org_members_org` (`organizationId`),
  INDEX `idx_org_members_user` (`userId`)
);

-- Inserir o admin padrão como owner da organização padrão
-- Será resolvido no bootstrap.ts se o usuário admin existir
-- (seed idempotente feito no bootstrap)
