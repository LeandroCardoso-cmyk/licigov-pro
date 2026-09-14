-- 0301 — F-EMB1: embedding model migration + explicit vector-space lineage.
--
-- Rollout seguro:
--   1) adiciona lineage nullable;
--   2) identifica honestamente vetores históricos como text-embedding-004 / 768;
--   3) torna lineage obrigatória;
--   4) adiciona dimensão ao cache (as novas chaves também incluem modelo+dimensão);
--   5) cria ledger operacional de reindexação, sem texto-fonte/segredos.
--
-- A migration NÃO reindexa conteúdo e NÃO chama provider externo. A troca para
-- gemini-embedding-2 ocorre depois, por runner replay-safe supervisionado em staging.
ALTER TABLE `law_chunks` ADD COLUMN `embeddingModel` varchar(100);
--> statement-breakpoint
ALTER TABLE `law_chunks` ADD COLUMN `embeddingDimensions` int;
--> statement-breakpoint
UPDATE `law_chunks`
SET `embeddingModel` = 'text-embedding-004', `embeddingDimensions` = 768
WHERE `embeddingModel` IS NULL OR `embeddingDimensions` IS NULL;
--> statement-breakpoint
ALTER TABLE `law_chunks` MODIFY COLUMN `embeddingModel` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `law_chunks` MODIFY COLUMN `embeddingDimensions` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `embedding_cache` ADD COLUMN `dimensions` int;
--> statement-breakpoint
UPDATE `embedding_cache` SET `dimensions` = 768 WHERE `dimensions` IS NULL;
--> statement-breakpoint
ALTER TABLE `embedding_cache` MODIFY COLUMN `dimensions` int NOT NULL;
--> statement-breakpoint
CREATE TABLE `embedding_reindex_runs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `runId` varchar(36) NOT NULL,
  `environment` varchar(20) NOT NULL,
  `model` varchar(100) NOT NULL,
  `dimensions` int NOT NULL,
  `status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
  `totalChunks` int NOT NULL DEFAULT 0,
  `processedChunks` int NOT NULL DEFAULT 0,
  `failedChunks` int NOT NULL DEFAULT 0,
  `errorCode` varchar(100),
  `startedAt` timestamp NOT NULL DEFAULT (now()),
  `completedAt` timestamp,
  CONSTRAINT `embedding_reindex_runs_id` PRIMARY KEY(`id`),
  CONSTRAINT `embedding_reindex_runs_runId_unique` UNIQUE(`runId`)
);
