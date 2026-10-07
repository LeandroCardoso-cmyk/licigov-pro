-- 0317 — Institutional Templates: ESCOPO MULTI-MODELO do binding (forma + plataforma) e rótulo de apresentação da identidade.
--
-- Contrato: server/domain/institutionalTemplates/binding.ts (BindingScope) e docs/architecture/INSTITUTIONAL_TEMPLATES_MULTIMODEL.md.
--
-- O que muda (ADITIVO; só tabelas DESTE bounded context, criadas na 0316 — NENHUM DDL em pai produtivo existente):
--  1) institutional_template_bindings:
--     - scope_form / scope_platform varchar(64) NOT NULL DEFAULT '' ('' = não especificado, como as demais chaves do escopo);
--     - active_scope_key (coluna GERADA, STORED, colação binária) passa a incluir forma e plataforma:
--         concat_ws('|', document_kind, scope_modality, scope_form, scope_platform, scope_regime, scope_criterion)
--       e o UNIQUE(organization_id, active_scope_key) — com o MESMO nome `uq_itb_active_scope` — passa a valer sobre o escopo
--       COMPLETO: no máximo UM binding ATIVO por (organização, tipo, escopo exato). Formas/plataformas diferentes COEXISTEM;
--       o mesmo escopo completo conflita. O tamanho da coluna cresce (224 → 352) porque a chave agora tem até 5 valores de 64.
--     - linhas existentes: forma/plataforma ficam '' (DEFAULT) e a chave é recalculada pelo banco; nenhuma linha é reescrita
--       por regra de negócio, nada é inferido. A chave continua INJETIVA (todos os componentes entram, inclusive os vazios).
--  2) institutional_template_identities.display_name varchar(160) NOT NULL DEFAULT '' — rótulo de APRESENTAÇÃO (metadado
--     puro: não é regra jurídica, não define aplicabilidade, não entra em hash). '' = ausente ⇒ a UX usa o slug.
--
-- HD-26: nenhuma FK criada/alterada/removida; as 9 FKs compostas de tenant da 0316 permanecem intactas (o UNIQUE
-- (organization_id, id) dos pais não é tocado). Nenhum CASCADE.
--
-- REPLAY-SAFE: cada passo é guardado por INFORMATION_SCHEMA (reaplicar = no-op). Estado PARCIAL (processo morto no meio) é
-- completado pela reaplicação: colunas → expressão/índice → display_name, cada um idempotente. O ledger do Drizzle só
-- registra a migration depois do último passo; enquanto isso o validador de boot recusa o build ("migration mais recente
-- não aplicada"). Alterar a coluna GERADA reconstrói a tabela (ALGORITHM=COPY); a tabela é pequena e ainda dormente.
-- ROLLBACK lógico: colunas aditivas e com DEFAULT; o build anterior as ignora (não as escreve). Reverter a chave exigiria DDL
-- manual (não incluído) e só é seguro se nenhum binding diferir apenas por forma/plataforma.
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_itpl0317_apply`
--> statement-breakpoint
CREATE PROCEDURE `_itpl0317_apply`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND COLUMN_NAME = 'scope_form') = 0 THEN
    ALTER TABLE `institutional_template_bindings`
      ADD COLUMN `scope_form` varchar(64) NOT NULL DEFAULT '' AFTER `scope_modality`,
      ADD COLUMN `scope_platform` varchar(64) NOT NULL DEFAULT '' AFTER `scope_form`;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND COLUMN_NAME = 'scope_platform') = 0 THEN
    ALTER TABLE `institutional_template_bindings` ADD COLUMN `scope_platform` varchar(64) NOT NULL DEFAULT '' AFTER `scope_form`;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND COLUMN_NAME = 'active_scope_key' AND GENERATION_EXPRESSION LIKE '%scope_platform%') = 0 THEN
    IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND INDEX_NAME = 'uq_itb_active_scope') > 0 THEN
      ALTER TABLE `institutional_template_bindings` DROP INDEX `uq_itb_active_scope`;
    END IF;
    ALTER TABLE `institutional_template_bindings`
      MODIFY COLUMN `active_scope_key` varchar(352) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (if((`active` = 1),concat_ws('|',`document_kind`,`scope_modality`,`scope_form`,`scope_platform`,`scope_regime`,`scope_criterion`),NULL)) STORED;
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' AND INDEX_NAME = 'uq_itb_active_scope') = 0 THEN
    ALTER TABLE `institutional_template_bindings` ADD CONSTRAINT `uq_itb_active_scope` UNIQUE (`organization_id`, `active_scope_key`);
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_identities' AND COLUMN_NAME = 'display_name') = 0 THEN
    ALTER TABLE `institutional_template_identities` ADD COLUMN `display_name` varchar(160) NOT NULL DEFAULT '' AFTER `slug`;
  END IF;
END
--> statement-breakpoint
CALL `_itpl0317_apply`()
--> statement-breakpoint
DROP PROCEDURE IF EXISTS `_itpl0317_apply`
