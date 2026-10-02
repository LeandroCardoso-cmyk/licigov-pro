-- 0314 — R7 / PR-16 (SEM-020): evidência REAL do documento obrigatório da Contratação Direta.
--
-- Antes: "Anexar" gravava a referência FICTÍCIA `s3://anexo` (cliente) e "Validar" aceitava qualquer item, sem arquivo.
-- Agora o anexo é um upload S3 feito pelo SERVIDOR (chave `contratacao_direta/{workspace}/{timestamp}-{arquivo}`) com
-- SHA-256, tamanho e MIME; validar exige essa evidência. Contrato: server/domain/requiredDocumentEvidence.ts.
--
-- Puramente ADITIVO: colunas com DEFAULT neutro ('' / 0 / NULL). Nenhuma linha existente é reescrita nem inferida:
-- linhas legadas (`s3://anexo`, sem hash) simplesmente NÃO satisfazem a validação até um anexo real (decisão de
-- tratamento dessas linhas: humano — ver AUTONOMOUS_REMEDIATION_BLOCKERS.md).
-- REPLAY-SAFE: cada ADD COLUMN é guardado por INFORMATION_SCHEMA (reaplicação manual é no-op).
-- ROLLBACK lógico: o build anterior ignora as colunas.
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_rqd0314_apply`
--> statement-breakpoint
CREATE PROCEDURE `_rqd0314_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'required_documents' AND COLUMN_NAME = 'content_hash') = 0 THEN
    ALTER TABLE `required_documents`
      ADD COLUMN `content_hash` varchar(64) NOT NULL DEFAULT '',
      ADD COLUMN `size_bytes` int NOT NULL DEFAULT 0,
      ADD COLUMN `mime_type` varchar(120) NOT NULL DEFAULT '',
      ADD COLUMN `attached_by` int NULL,
      ADD COLUMN `attached_at` datetime(3) NULL,
      ADD COLUMN `validated_by` int NULL,
      ADD COLUMN `validated_at` datetime(3) NULL;
  END IF;
END
--> statement-breakpoint
CALL `_rqd0314_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_rqd0314_apply`
