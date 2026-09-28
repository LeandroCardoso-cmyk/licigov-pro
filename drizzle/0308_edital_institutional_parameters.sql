-- 0308 — PR-09 / R5 (SEM-009): parâmetros INSTITUCIONAIS complementares do Edital persistidos.
--
-- Critério de julgamento e regime de execução são FATOS institucionais do certame (decisão humana), não estado
-- de UI, padrão ou inferência. Passam a ser persistidos no MESMO lugar de modalidade/forma/plataforma: o
-- rascunho canônico do Edital (`generated_documents`, linha tenant-scoped por organization_id + process_id).
--
-- Puramente ADITIVA: duas colunas NULLABLE, SEM default e SEM backfill. Linhas existentes ficam NULL
-- (= "requer revisão"); nenhum valor é inventado. Nenhum DROP, UPDATE ou DELETE. Compatível com deploy
-- rolling (código antigo ignora as colunas). Texto bounded varchar(100) — o repositório não define lista
-- fechada para estes campos (espelha o legado edital_parameters.criterioJulgamento/regimeContratacao).
--
-- NUMERAÇÃO: outra branch (PR-06) também usa 0308; a colisão é resolvida por renumeração na integração
-- (renomear arquivo + tag/idx do journal; o SQL é independente de ordem em relação à PR-06).
--
-- REPLAY-SAFE: ADD COLUMN guardado por INFORMATION_SCHEMA (reaplicar = no-op). MySQL 8.4 e MariaDB
-- (procedure em statement único, sem SIGNAL).
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0308_add_col
--> statement-breakpoint
CREATE PROCEDURE licigov_0308_add_col(IN p_tbl VARCHAR(64), IN p_col VARCHAR(64), IN p_def TEXT)
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl) = 1
     AND (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_col) = 0 THEN
    SET @licigov_0308_ddl = CONCAT('ALTER TABLE `', p_tbl, '` ADD COLUMN `', p_col, '` ', p_def);
    PREPARE licigov_0308_stmt FROM @licigov_0308_ddl;
    EXECUTE licigov_0308_stmt;
    DEALLOCATE PREPARE licigov_0308_stmt;
  END IF;
END
--> statement-breakpoint
CALL licigov_0308_add_col('generated_documents', 'judgment_criterion', 'varchar(100) NULL')
--> statement-breakpoint
CALL licigov_0308_add_col('generated_documents', 'execution_regime', 'varchar(100) NULL')
--> statement-breakpoint
DROP PROCEDURE IF EXISTS licigov_0308_add_col
