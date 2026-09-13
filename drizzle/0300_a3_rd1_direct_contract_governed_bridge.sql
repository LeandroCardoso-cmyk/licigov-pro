-- 0300 — A3-RD1: BRIDGE GOVERNADA (aditiva) em `direct_contracts`.
--
-- Permite que um registro de contratação direta aponte para o domínio GOVERNADO de referência
-- jurídica (legal_reference_entries) sem fabricar um `legalArticleId` legado. Puramente ADITIVA e
-- compatível: NÃO remove `legalArticleId`, NÃO dropa a tabela legada, NÃO faz backfill/conversão
-- retroativa (registros históricos permanecem LEGACY — conversão exigiria autoridade jurídica
-- retroativa, fora de escopo). Replay-safe via ledger do Drizzle (aplicada uma única vez).
--
-- Modelo de identidade (exatamente-um), imposto na camada de aplicação (router):
--   LEGACY   -> legalArticleId != NULL  &  legalReferenceEntryId = NULL
--   GOVERNED -> legalReferenceEntryId != NULL  &  legalArticleId = NULL
-- Por isso `legalArticleId` passa a ser NULLABLE (widening seguro; novos registros governados não
-- preenchem a coluna legada). NUNCA comparar IDs numéricos de tabelas distintas.
ALTER TABLE `direct_contracts` MODIFY COLUMN `legalArticleId` int;
--> statement-breakpoint
ALTER TABLE `direct_contracts` ADD COLUMN `legalReferenceEntryId` int;
--> statement-breakpoint
ALTER TABLE `direct_contracts` ADD COLUMN `legalReferenceSetVersion` int;
--> statement-breakpoint
ALTER TABLE `direct_contracts` ADD COLUMN `legalReferenceLocator` varchar(120);
