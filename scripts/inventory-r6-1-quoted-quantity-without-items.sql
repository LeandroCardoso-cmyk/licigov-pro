-- R6.1 — INVENTÁRIO READ-ONLY (SEM-008 / PR-13): processos cuja única quantidade é a da COTAÇÃO.
--
-- NÃO EXECUTADO por esta branch. Execução exige mecanismo de leitura legítimo e autorização própria
-- (BLOCKED_PRODUCTION_ACCESS). Somente SELECT agregado; sem descrições, nomes ou conteúdo documental.
--
-- Pergunta: quantos processos ATIVOS têm Itens Inteligentes APROVADOS e NENHUM Item da contratação ativo
-- (modo legado) — e quantos deles já têm TR/Edital gerado (que hoje carregam a quantidade cotada)?
-- Após o PR-13, gerar/regenerar TR/Edital nesses processos falha com CANONICAL_ITEMS_REQUIRED até que a pessoa
-- cadastre os Itens da contratação com a quantidade prevista (decisão R6.2).
--
-- Colação: as subconsultas comparam ids de tabelas com colações distintas; a coluna do processo recebe COLLATE
-- explícito do lado do filho quando necessário (mesmo padrão de server/db/processLifecycle.ts).

SELECT
  p.organization_id                                                         AS organization_id,
  COUNT(*)                                                                  AS legacy_processes,
  SUM(EXISTS (SELECT 1 FROM generated_documents g
              WHERE g.organization_id = p.organization_id AND g.process_id = p.id AND g.kind = 'tr'))      AS with_tr,
  SUM(EXISTS (SELECT 1 FROM generated_documents g
              WHERE g.organization_id = p.organization_id AND g.process_id = p.id AND g.kind = 'edital'))  AS with_edital,
  SUM(EXISTS (SELECT 1 FROM official_document_promotions o
              WHERE o.organization_id = p.organization_id AND o.process_id = p.id COLLATE utf8mb4_0900_ai_ci))                         AS with_official_promotion
FROM procurement_processes p
WHERE p.lifecycle_state = 'active'
  AND EXISTS (SELECT 1 FROM intelligent_items ii
              WHERE ii.organization_id = p.organization_id AND ii.process_id = p.id AND ii.status = 'aprovado')
  AND NOT EXISTS (SELECT 1 FROM procurement_items pi
                  WHERE pi.organization_id = p.organization_id AND pi.process_id = p.id COLLATE utf8mb4_0900_ai_ci AND pi.status = 'active')
GROUP BY p.organization_id
ORDER BY p.organization_id;

-- Observação: em bases anteriores à 0313 a coluna lifecycle_state não existe — remova o filtro
-- `p.lifecycle_state = 'active'` nesse caso (todas as linhas são a geração única ativa).
