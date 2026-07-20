-- Contrato avulso (revisão arquitetural): registra o usuário responsável pela criação
-- do workspace. Nullable — os workspaces já existentes (3 fluxos anteriores: processo,
-- contratação direta, externo) não têm essa informação retroativamente disponível;
-- ficam com created_by = NULL, sem quebra de compatibilidade. Aditiva, sem DROP/ALTER
-- destrutivo, reversível (basta não popular a coluna).
ALTER TABLE `contract_workspaces` ADD COLUMN `created_by` INT NULL;
