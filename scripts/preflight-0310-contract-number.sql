-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PREFLIGHT READ-ONLY da migration 0310 (número oficial do contrato ÚNICO POR ORGANIZAÇÃO, qualquer origem).
--
-- SOMENTE LEITURA — nenhuma linha é alterada. Rode contra o banco ATUAL (pré-0310) para saber, ANTES do deploy, se a
-- 0310 vai CONVERGIR ou ABORTAR (fail-closed, SIGNAL '0310_FC_DUP_CONTRACT_NUMBER_PER_ORG'). Só CONTAGENS agregadas:
-- nenhum número de contrato, contratado, objeto, valor ou id é exibido (sem PII / dado institucional).
--
-- Regra da chave (idêntica ao guard e ao UNIQUE da 0310):
--   (organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin)
--   — só espaços das pontas são removidos; caixa, zeros, ano e pontuação preservados; número vazio não entra.
--
-- Resultado: se "GUARD (bloqueia)" = 0, a 0310 converge. Se > 0, a 0310 abortará sem tocar em nada; a remediação é
-- decisão HUMANA (corrigir o número na origem) — a migration nunca escolhe qual contrato "vale" nem deduplica.
--
-- Uso:  mysql -h <host> -P <port> -u <user> -p <db> < scripts/preflight-0310-contract-number.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- 0) INFORMATIVO — inventário atual.
SELECT 'contratos (contract_workspaces)' AS metrica, COUNT(*) AS valor FROM contract_workspaces;
SELECT 'organizacoes com contratos' AS metrica, COUNT(DISTINCT organization_id) AS valor FROM contract_workspaces;
SELECT CONCAT('contratos por origem: ', origin_type) AS metrica, COUNT(*) AS valor
  FROM contract_workspaces GROUP BY origin_type ORDER BY origin_type;

-- GUARD — BLOQUEIA se > 0: grupos (organização, número normalizado) com 2+ contratos (qualquer origem).
SELECT 'GUARD (bloqueia): grupos duplicados' AS guard, COUNT(*) AS bloqueia FROM (
  SELECT organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin AS k
    FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, k
  HAVING COUNT(*) > 1
) d;

-- Detalhe do GUARD (ainda só contagens): contratos envolvidos, organizações afetadas, e quantos grupos misturam
-- origens diferentes vs. repetem a mesma origem (esta última só é possível via espaços nas pontas ou escrita manual).
SELECT 'contratos em grupos duplicados' AS metrica, COALESCE(SUM(n), 0) AS valor FROM (
  SELECT COUNT(*) AS n FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin HAVING COUNT(*) > 1
) d;
SELECT 'organizacoes afetadas' AS metrica, COUNT(DISTINCT organization_id) AS valor FROM (
  SELECT organization_id FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin HAVING COUNT(*) > 1
) d;
SELECT 'grupos duplicados entre origens diferentes' AS metrica, COUNT(*) AS valor FROM (
  SELECT 1 FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin
  HAVING COUNT(*) > 1 AND COUNT(DISTINCT origin_type) > 1
) d;
SELECT 'grupos duplicados na mesma origem' AS metrica, COUNT(*) AS valor FROM (
  SELECT 1 FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin
  HAVING COUNT(*) > 1 AND COUNT(DISTINCT origin_type) = 1
) d;
SELECT 'grupos duplicados com contrato fora de minuta' AS metrica, COUNT(*) AS valor FROM (
  SELECT 1 FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin
  HAVING COUNT(*) > 1 AND SUM(status <> 'minuta') > 0
) d;

-- INFORMATIVO (NÃO bloqueia) — casos de borda da normalização mínima, para decisão humana:
--   a) número vazio/só espaços: fica NULL em normalized_number e não participa da unicidade;
SELECT 'INFO numero vazio ou so espacos' AS metrica, COUNT(*) AS valor
  FROM contract_workspaces WHERE NULLIF(TRIM(contract_number), '') IS NULL;
--   b) número com espaço nas pontas (a 0310 os iguala à versão sem espaço);
SELECT 'INFO numero com espaco nas pontas' AS metrica, COUNT(*) AS valor
  FROM contract_workspaces WHERE contract_number <> TRIM(contract_number) COLLATE utf8mb4_bin;
--   c) número com QUALQUER branco nas pontas (espaço, TAB, CR, LF). Diferença c − b = casos com TAB/CR/LF, que o TRIM
--      do SQL NÃO remove (ficam distintos no banco; a aplicação já grava o número sem nenhum branco nas pontas);
SELECT 'INFO numero com qualquer branco nas pontas' AS metrica, COUNT(*) AS valor
  FROM contract_workspaces
 WHERE contract_number REGEXP '^[[:space:]]' OR contract_number REGEXP '[[:space:]]$';
--   d) grupos que só colidiriam ignorando CAIXA/ACENTO (colação da tabela) — a 0310 NÃO os iguala (colação binária).
SELECT 'INFO grupos que diferem so por caixa/acento' AS metrica, COUNT(*) AS valor FROM (
  SELECT 1 FROM contract_workspaces
   WHERE NULLIF(TRIM(contract_number), '') IS NOT NULL
   GROUP BY organization_id, NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_unicode_ci
  HAVING COUNT(DISTINCT NULLIF(TRIM(contract_number), '') COLLATE utf8mb4_bin) > 1
) d;
