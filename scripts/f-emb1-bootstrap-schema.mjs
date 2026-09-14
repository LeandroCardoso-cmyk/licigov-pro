#!/usr/bin/env node
/**
 * TEMPORARY F-EMB1 bootstrap scaffold.
 *
 * Patches the monolithic Drizzle schema with embedding lineage, lets drizzle-kit generate the
 * canonical journal/snapshot, then replaces ONLY the generated SQL with the rollout-safe
 * backfill migration. This file and its workflow MUST be removed immediately after generation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "drizzle/schema.ts");
const mode = process.argv[2];

const LAW_OLD = `export const lawChunks = mysqlTable("law_chunks", {
  id: int("id").autoincrement().primaryKey(),
  lawName: varchar("lawName", { length: 100 }).notNull(), // "Lei 14.133/21"
  chunkIndex: int("chunkIndex").notNull(), // Ordem do chunk
  articleNumber: varchar("articleNumber", { length: 20 }), // "Art. 6º"
  content: text("content").notNull(), // Texto do chunk
  embedding: json("embedding").notNull(), // Vector de embeddings
  metadata: json("metadata"), // { section: "...", topic: "..." }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});`;

const LAW_NEW = `export const lawChunks = mysqlTable("law_chunks", {
  id: int("id").autoincrement().primaryKey(),
  lawName: varchar("lawName", { length: 100 }).notNull(), // "Lei 14.133/21"
  chunkIndex: int("chunkIndex").notNull(), // Ordem do chunk
  articleNumber: varchar("articleNumber", { length: 20 }), // "Art. 6º"
  content: text("content").notNull(), // Texto do chunk
  embedding: json("embedding").notNull(), // Vector de embeddings
  // F-EMB1 — lineage explícita: vetores só podem ser comparados no mesmo espaço vetorial.
  embeddingModel: varchar("embeddingModel", { length: 100 }).notNull(),
  embeddingDimensions: int("embeddingDimensions").notNull(),
  metadata: json("metadata"), // { section: "...", topic: "..." }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});`;

const CACHE_OLD = `  embedding: json("embedding").notNull(), // Vector de embeddings
  model: varchar("model", { length: 50 }).notNull(), // "text-embedding-004"
  hitCount: int("hitCount").default(0).notNull(), // Número de vezes que foi reutilizado`;

const CACHE_NEW = `  embedding: json("embedding").notNull(), // Vector de embeddings
  model: varchar("model", { length: 50 }).notNull(), // identidade do espaço vetorial
  // F-EMB1 — dimensão persistida impede cache cross-space mesmo se o texto for idêntico.
  dimensions: int("dimensions").notNull(),
  hitCount: int("hitCount").default(0).notNull(), // Número de vezes que foi reutilizado`;

const TYPES_OLD = `export type LawChunk = typeof lawChunks.$inferSelect;
export type InsertLawChunk = typeof lawChunks.$inferInsert;`;

const TYPES_NEW = `export type LawChunk = typeof lawChunks.$inferSelect;
export type InsertLawChunk = typeof lawChunks.$inferInsert;

/**
 * F-EMB1 — ledger operacional persistido de reindexações do corpus jurídico global.
 * Não armazena texto-fonte, chave de API ou vetor; somente lineage/contadores/estado.
 */
export const embeddingReindexRuns = mysqlTable("embedding_reindex_runs", {
  id: int("id").autoincrement().primaryKey(),
  runId: varchar("runId", { length: 36 }).notNull().unique(),
  environment: varchar("environment", { length: 20 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  dimensions: int("dimensions").notNull(),
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  totalChunks: int("totalChunks").default(0).notNull(),
  processedChunks: int("processedChunks").default(0).notNull(),
  failedChunks: int("failedChunks").default(0).notNull(),
  errorCode: varchar("errorCode", { length: 100 }),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type EmbeddingReindexRun = typeof embeddingReindexRuns.$inferSelect;
export type InsertEmbeddingReindexRun = typeof embeddingReindexRuns.$inferInsert;`;

function replaceExactly(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}_CARDINALITY_INVALID:${count}`);
  return source.replace(before, after);
}

function prepare() {
  let schema = fs.readFileSync(schemaPath, "utf8");
  schema = replaceExactly(schema, LAW_OLD, LAW_NEW, "LAW_CHUNKS_PATCH");
  schema = replaceExactly(schema, CACHE_OLD, CACHE_NEW, "EMBEDDING_CACHE_PATCH");
  schema = replaceExactly(schema, TYPES_OLD, TYPES_NEW, "REINDEX_LEDGER_PATCH");
  fs.writeFileSync(schemaPath, schema);
  console.info("[F-EMB1][bootstrap] schema prepared");
}

function finalize() {
  const drizzleDir = path.join(root, "drizzle");
  const candidates = fs.readdirSync(drizzleDir)
    .filter((name) => /^0301_.*\.sql$/.test(name));
  if (candidates.length !== 1) {
    throw new Error(`MIGRATION_0301_CARDINALITY_INVALID:${candidates.length}`);
  }

  const migrationPath = path.join(drizzleDir, candidates[0]);
  const sql = `-- 0301 — F-EMB1: embedding model migration + explicit vector-space lineage.\n--\n-- Rollout seguro:\n--   1) adiciona lineage nullable;\n--   2) identifica honestamente vetores históricos como text-embedding-004 / 768;\n--   3) torna lineage obrigatória;\n--   4) adiciona dimensão ao cache (as novas chaves também incluem modelo+dimensão);\n--   5) cria ledger operacional de reindexação, sem texto-fonte/segredos.\n--\n-- A migration NÃO reindexa conteúdo e NÃO chama provider externo. A troca para\n-- gemini-embedding-2 ocorre depois, por runner replay-safe supervisionado em staging.\nALTER TABLE \`law_chunks\` ADD COLUMN \`embeddingModel\` varchar(100);\n--> statement-breakpoint\nALTER TABLE \`law_chunks\` ADD COLUMN \`embeddingDimensions\` int;\n--> statement-breakpoint\nUPDATE \`law_chunks\`\nSET \`embeddingModel\` = 'text-embedding-004', \`embeddingDimensions\` = 768\nWHERE \`embeddingModel\` IS NULL OR \`embeddingDimensions\` IS NULL;\n--> statement-breakpoint\nALTER TABLE \`law_chunks\` MODIFY COLUMN \`embeddingModel\` varchar(100) NOT NULL;\n--> statement-breakpoint\nALTER TABLE \`law_chunks\` MODIFY COLUMN \`embeddingDimensions\` int NOT NULL;\n--> statement-breakpoint\nALTER TABLE \`embedding_cache\` ADD COLUMN \`dimensions\` int;\n--> statement-breakpoint\nUPDATE \`embedding_cache\` SET \`dimensions\` = 768 WHERE \`dimensions\` IS NULL;\n--> statement-breakpoint\nALTER TABLE \`embedding_cache\` MODIFY COLUMN \`dimensions\` int NOT NULL;\n--> statement-breakpoint\nCREATE TABLE \`embedding_reindex_runs\` (\n  \`id\` int AUTO_INCREMENT NOT NULL,\n  \`runId\` varchar(36) NOT NULL,\n  \`environment\` varchar(20) NOT NULL,\n  \`model\` varchar(100) NOT NULL,\n  \`dimensions\` int NOT NULL,\n  \`status\` enum('running','completed','failed') NOT NULL DEFAULT 'running',\n  \`totalChunks\` int NOT NULL DEFAULT 0,\n  \`processedChunks\` int NOT NULL DEFAULT 0,\n  \`failedChunks\` int NOT NULL DEFAULT 0,\n  \`errorCode\` varchar(100),\n  \`startedAt\` timestamp NOT NULL DEFAULT (now()),\n  \`completedAt\` timestamp,\n  CONSTRAINT \`embedding_reindex_runs_id\` PRIMARY KEY(\`id\`),\n  CONSTRAINT \`embedding_reindex_runs_runId_unique\` UNIQUE(\`runId\`)\n);\n`;
  fs.writeFileSync(migrationPath, sql);

  const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8"));
  const last = journal.entries.at(-1);
  if (last?.idx !== 301 || !String(last.tag).startsWith("0301_")) {
    throw new Error(`JOURNAL_0301_INVALID:${JSON.stringify(last)}`);
  }

  const allowed = new Set([
    "drizzle/schema.ts",
    candidates[0],
    "drizzle/meta/_journal.json",
    "drizzle/meta/0301_snapshot.json",
  ]);
  const changed = process.env.F_EMB1_CHANGED_FILES?.split("\n").filter(Boolean) ?? [];
  for (const file of changed) {
    if (!allowed.has(file)) throw new Error(`UNEXPECTED_GENERATED_FILE:${file}`);
  }

  console.info(`[F-EMB1][bootstrap] migration=${candidates[0]} journal_idx=301 finalized`);
}

if (mode === "--prepare") prepare();
else if (mode === "--finalize") finalize();
else throw new Error("USAGE: --prepare | --finalize");
