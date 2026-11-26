-- 0320 — LICIGOV-LAUNCH-READY LR-02: a solicitação de proposta (manifestação de interesse) não depende de plano, preço ou seed.
--
-- ADITIVA e NÃO destrutiva: só relaxa NOT NULL em 3 colunas de `proposal_requests`; nenhuma linha existente é alterada
-- (valores gravados permanecem). Compatível com o build anterior (que sempre grava as três). Replay-safe via ledger do Drizzle.
-- ROLLBACK lógico: voltar a NOT NULL exigiria backfill das linhas novas (NULL) — DDL manual não incluída.
ALTER TABLE `proposal_requests` MODIFY COLUMN `planSlug` varchar(50);--> statement-breakpoint
ALTER TABLE `proposal_requests` MODIFY COLUMN `planName` varchar(100);--> statement-breakpoint
ALTER TABLE `proposal_requests` MODIFY COLUMN `planPrice` int;