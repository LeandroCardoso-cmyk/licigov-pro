-- 0318 — Template Governance V2: MARCO DE TRANSIÇÃO do padrão de política jurídica dos modelos institucionais.
--
-- Contrato: docs/architecture/TEMPLATE_GOVERNANCE_V2.md (§3 e §9) e server/db/templateGovernanceTransition.ts.
--
-- O que muda (ADITIVO; tabela NOVA, PLATFORM-LEVEL, sem organization_id e SEM FK — nenhum DDL em tabela existente):
--  1) template_governance_transitions: um registro por marco (`marker_key` PK).
--  2) Semeia UMA vez o marco `LEGACY_POLICY_CUTOVER` com o INSTANTE EFETIVO desta aplicação (UTC, ISO-8601 com milissegundos) — ou seja, o instante do
--     PRIMEIRO deploy da Governance V2. Órgãos com modelos (identidades) criados ANTES dele permanecem em LEGACY_COMPAT (evidência jurídica exigida);
--     órgãos sem modelos anteriores recebem o padrão da plataforma (OPTIONAL).
--
-- ESTABILIDADE / AUDITORIA: `INSERT IGNORE` por chave primária — reaplicar a migration, ou aplicar outras migrations/deploys depois, NUNCA move o marco
-- nem reclassifica órgãos legados. A aplicação só LÊ a tabela (nenhum UPDATE/DELETE; guarda estática em teste). `recorded_by` identifica a migration e
-- `recorded_at` é o relógio do banco: ambos auditáveis por consulta somente leitura:
--   SELECT marker_key, cutover_at_iso, recorded_by, recorded_at FROM template_governance_transitions;
-- FAIL-CLOSED: sem a linha (ou ilegível), a aplicação trata TODO órgão sem política registrada como estrito (evidência exigida) — o comportamento anterior.
--
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS + INSERT IGNORE (estado parcial é completado pela reaplicação sem mover o marco).
-- ROLLBACK lógico: o build anterior ignora a tabela; removê-la exigiria DDL manual (não incluído) e faria o build novo voltar ao modo estrito.
CREATE TABLE IF NOT EXISTS `template_governance_transitions` (
	`marker_key` varchar(64) NOT NULL,
	`cutover_at_iso` varchar(40) NOT NULL,
	`recorded_by` varchar(96) NOT NULL,
	`note` varchar(255) NOT NULL DEFAULT '',
	`recorded_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `template_governance_transitions_marker_key` PRIMARY KEY(`marker_key`)
);
--> statement-breakpoint
INSERT IGNORE INTO `template_governance_transitions` (`marker_key`, `cutover_at_iso`, `recorded_by`, `note`)
SELECT 'LEGACY_POLICY_CUTOVER',
       CONCAT(DATE_FORMAT(x.t, '%Y-%m-%dT%H:%i:%s.'), LPAD(CAST(FLOOR(MICROSECOND(x.t) / 1000) AS CHAR), 3, '0'), 'Z'),
       'migration:0318_template_governance_transition',
       'Instante efetivo do primeiro deploy da Template Governance V2 (UTC). Órgãos com modelos anteriores ficam em LEGACY_COMPAT. Imutável.'
FROM (SELECT UTC_TIMESTAMP(3) AS t) x;
