-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT READ-ONLY da migration 0302 (identidade institucional tenant-scoped, sem duplicidade).
--
-- SOMENTE LEITURA — nenhuma linha é alterada. Rode contra a produção ATUAL (pré-0302) para saber, ANTES
-- do deploy, se a migration vai CONVERGIR ou ABORTAR (fail-closed). Cada consulta mapeia 1:1 um guard da
-- 0302. Se todas retornarem 0 (exceto as contagens informativas), a migration converge; qualquer guard
-- > 0 significa que a 0302 abortará e o dado precisa ser reconciliado manualmente antes do deploy.
--
-- Uso:  mysql -h <host> -P <port> -u <user> -p <db> < scripts/preflight-0302.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 0) INFORMATIVO — inventário atual.
SELECT 'linhas em documentSettings' AS metrica, COUNT(*) AS valor FROM documentSettings;
SELECT 'usuarios distintos com documentSettings' AS metrica, COUNT(DISTINCT userId) AS valor FROM documentSettings;
SELECT 'organizacoes distintas (destino) alcancadas' AS metrica,
       COUNT(DISTINCT m.organizationId) AS valor
  FROM documentSettings ds
  JOIN organization_members m ON m.userId = ds.userId AND m.ativo = 1;

-- A) BLOQUEIA se > 0 — documentSettings de usuário SEM organização ativa (órfão).
SELECT 'GUARD A (orfaos)' AS guard, COUNT(*) AS bloqueia FROM documentSettings ds
 WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.userId = ds.userId AND m.ativo = 1);

-- B) BLOQUEIA se > 0 — documentSettings de usuário com MAIS DE UMA organização ativa (destino ambíguo).
SELECT 'GUARD B (multi-org)' AS guard, COUNT(*) AS bloqueia FROM documentSettings ds
 WHERE (SELECT COUNT(*) FROM organization_members m WHERE m.userId = ds.userId AND m.ativo = 1) > 1;

-- C) BLOQUEIA se > 0 — 2+ documentSettings para o MESMO tenant com identidade DIFERENTE (consolidação ambígua).
SELECT 'GUARD C (conflito de tenant)' AS guard, COUNT(*) AS bloqueia FROM (
  SELECT m.organizationId
    FROM documentSettings ds
    JOIN organization_members m ON m.userId = ds.userId AND m.ativo = 1
   GROUP BY m.organizationId
  HAVING COUNT(DISTINCT CONCAT_WS('\n',
           COALESCE(TRIM(ds.organizationName),''), COALESCE(TRIM(ds.logoUrl),''),
           COALESCE(TRIM(ds.address),''),
           COALESCE(REPLACE(REPLACE(REPLACE(TRIM(ds.cnpj),'.',''),'/',''),'-',''),''),
           COALESCE(TRIM(ds.phone),''), COALESCE(TRIM(ds.email),''),
           COALESCE(TRIM(ds.website),''), COALESCE(TRIM(ds.footerText),''))) > 1
) t;

-- D) BLOQUEIA se > 0 — organizationName não-vazio DIVERGE de organizations.nome (fonte canônica).
SELECT 'GUARD D (conflito de nome)' AS guard, COUNT(*) AS bloqueia FROM documentSettings ds
  JOIN organization_members m ON m.userId = ds.userId AND m.ativo = 1
  JOIN organizations o ON o.id = m.organizationId
 WHERE TRIM(COALESCE(ds.organizationName,'')) <> ''
   AND LOWER(TRIM(ds.organizationName)) <> LOWER(TRIM(o.nome));

-- E) BLOQUEIA se > 0 — cnpj não-vazio DIVERGE de organizations.cnpj (quando o canônico já existe).
SELECT 'GUARD E (conflito de cnpj)' AS guard, COUNT(*) AS bloqueia FROM documentSettings ds
  JOIN organization_members m ON m.userId = ds.userId AND m.ativo = 1
  JOIN organizations o ON o.id = m.organizationId
 WHERE TRIM(COALESCE(ds.cnpj,'')) <> ''
   AND o.cnpj IS NOT NULL
   AND REPLACE(REPLACE(REPLACE(TRIM(ds.cnpj),'.',''),'/',''),'-','') <> REPLACE(REPLACE(REPLACE(TRIM(o.cnpj),'.',''),'/',''),'-','');

-- F) INFORMATIVO — CNPJs que serão PROMOVIDOS ao canônico (organizations.cnpj NULO + documentSettings tem CNPJ).
SELECT 'INFO F (cnpj a promover)' AS info, COUNT(*) AS linhas FROM documentSettings ds
  JOIN organization_members m ON m.userId = ds.userId AND m.ativo = 1
  JOIN organizations o ON o.id = m.organizationId
 WHERE o.cnpj IS NULL AND TRIM(COALESCE(ds.cnpj,'')) <> '';
