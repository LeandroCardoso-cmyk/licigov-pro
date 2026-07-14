-- SPRINT 5.3.1 — consolidação: metadados auditáveis de minuta + origem do aditivo.
--
-- As colunas `contract_ws_documents.metadata` e `contract_addenda.request_origin`
-- são adicionadas de forma IDEMPOTENTE pelo safety net `ensureSchema()` em
-- server/bootstrap.ts (addColumnIfMissing). Evita-se aqui o `ALTER TABLE ADD
-- COLUMN` cru porque: (1) MySQL não suporta `ADD COLUMN IF NOT EXISTS`, o que
-- quebraria em re-execuções/estado parcial; (2) a conexão do migrator não habilita
-- multipleStatements, então dois ALTER no mesmo arquivo (sem statement-breakpoint)
-- são enviados como uma única query e falham no startup. Migração no-op segura.
DO 1;
