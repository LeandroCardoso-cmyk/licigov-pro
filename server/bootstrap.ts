import path from "path";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { RowDataPacket } from "mysql2";
import { APP_ENV, ENV_TAG, validateRequiredEnv } from "./config/env";
import { APP_CONFIG } from "./config/app";
import { AWS_CONFIG } from "./config/aws";
import { AI_CONFIG, validateAiRuntime, validateAiProviderConfig } from "./config/ai";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Logging helper ───────────────────────────────────────────────────────────

function log(module: string, msg: string): void {
  console.info(`[BOOT]${ENV_TAG}[${module}] ${msg}`);
}

// ─── Step 1: run pending migrations ──────────────────────────────────────────

// Exportada para os smokes MySQL que constroem o schema num banco real (migrate() já é
// suficiente desde a Fase B — a 0297 fechou o schema; não há mais reconciliação em runtime).
// O boot usa `migrateWithAdvisoryLock` (com lock); esta variante sem lock atende aos testes.
export async function runMigrations(connection: mysql.Connection): Promise<void> {
  log("DB", `Executando migrações de: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  log("DB", "✓ Migrações aplicadas");
}

// ─── Step 2: validar o schema (NÃO-MUTÁVEL) ──────────────────────────────────
// Fase B (RUNTIME & RELEASE SAFETY): antes, ensureSchema() era um RECONCILIADOR que executava
// DDL (ALTER/CREATE/RENAME) a cada boot para "consertar" o banco em runtime. Isso saiu: TODA
// mudança de schema mora agora em migrations versionadas (a migration 0297 fechou a diferença
// que só existia no reconciliador — ver drizzle/0297_phase_b_schema_closure.sql). Este passo é
// um DETECTOR/VALIDATOR, não um reconciliador, e é a ÚNICA responsabilidade do boot sobre schema
// (as migrations são aplicadas ANTES, no passo de release — ver bootstrap()):
//   - NÃO executa DDL (nenhum ALTER/CREATE/DROP/RENAME/push/índice) e NÃO aplica migrations;
//   - prova que a migration MAIS RECENTE do build está aplicada (ledger canônico do Drizzle);
//   - confere estruturas críticas como defesa adicional;
//   - staging/produção: FALHA FECHADA (fail-closed) se o schema estiver incompatível/atrás;
//   - desenvolvimento: apenas AVISA (um banco local pode legitimamente estar atrasado).

/**
 * Hash + tag da migration MAIS RECENTE esperada pelo build (a última do journal do Drizzle).
 * Reutiliza o leitor canônico do Drizzle (readMigrationFiles) — o mesmo `hash` que o migrator
 * grava em `__drizzle_migrations` ao aplicar. Puro; lê do disco (drizzle/). Tolerante a falha.
 * O `tag` é apenas diagnóstico. NÃO hardcoda número de migration: acompanha futuras automaticamente.
 */
export function expectedLatestMigration(): { hash: string; tag: string } | null {
  try {
    const metas = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    if (metas.length === 0) return null;
    const latest = metas[metas.length - 1];
    let tag = "(mais recente)";
    try {
      const journal = JSON.parse(
        readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
      ) as { entries?: Array<{ tag?: string }> };
      const entries = journal.entries ?? [];
      const last = entries[entries.length - 1];
      if (last?.tag) tag = String(last.tag);
    } catch {
      /* tag é só diagnóstica — a prova é o hash */
    }
    return { hash: latest.hash, tag };
  } catch {
    return null;
  }
}

// Estruturas CRÍTICAS — DEFESA ADICIONAL sobre a prova da migration mais recente. NÃO usamos a
// CONTAGEM de linhas do ledger como medida de completude: a produção/staging deste projeto
// NASCERAM de `db:push` com o journal do Drizzle "baseline-stampado" (o ledger é legitimamente
// ESPARSO — menos linhas que a cadeia — embora o schema esteja COMPLETO). Cobre invariantes de
// maior valor de TODAS as épocas — multi-tenant, segurança (PR 0), acesso institucional, ciclo
// documental oficial e ingestão canônica.
const CRITICAL_TABLES: readonly string[] = [
  "users", "organizations", "organization_members", "processes", "documents",
  "audit_logs", "activity_logs", "process_members",
  "institutional_invitations", "password_reset_tokens", "email_outbox",
  "official_documents", "import_sessions",
];
const CRITICAL_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["users", "passwordHash"], ["users", "tokenVersion"], ["users", "email"],
  ["process_members", "functionalRole"],
  ["processes", "organizationId"], ["documents", "organizationId"], ["activity_logs", "organizationId"],
  ["import_sessions", "checksum"], ["documents", "documentStatus"],
];

export type SchemaValidationLevel = "ok" | "warn" | "fail";

/**
 * Decisão PURA e testável do validator: schema íntegro → "ok"; incompatível em
 * desenvolvimento → "warn" (banco local pode legitimamente atrasar); incompatível em
 * staging/produção → "fail" (fail-closed: a aplicação não fica online parcialmente compatível).
 */
export function decideSchemaValidation(
  problems: readonly string[],
  isDevelopment: boolean,
): SchemaValidationLevel {
  if (problems.length === 0) return "ok";
  return isDevelopment ? "warn" : "fail";
}

/**
 * DETECÇÃO PURA (sem env, sem lançar) dos problemas de compatibilidade do schema. Separada de
 * validateSchema para ser testável de forma determinística (não depende de APP_ENV). NÃO muta nada.
 */
export async function collectSchemaProblems(connection: mysql.Connection): Promise<string[]> {
  type Cnt = { cnt: number };
  const problems: string[] = [];

  async function tableExists(table: string): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return (rows[0] as Cnt).cnt > 0;
  }
  async function columnExists(table: string, column: string): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return (rows[0] as Cnt).cnt > 0;
  }

  // 1) A migration MAIS RECENTE do build precisa estar aplicada — provado pelo LEDGER canônico do
  //    Drizzle (__drizzle_migrations), por HASH. NÃO por contagem de linhas (o journal é
  //    baseline-stampado; o ledger é legitimamente esparso) e SEM hardcodar número de migration
  //    (readMigrationFiles acompanha automaticamente a última do build). Detecta migration recente
  //    ausente mesmo que o restante do schema pareça íntegro.
  if (!(await tableExists("__drizzle_migrations"))) {
    problems.push("tabela de controle de migrations (__drizzle_migrations) ausente — schema nunca inicializado por migrations");
  } else {
    const latest = expectedLatestMigration();
    if (latest === null) {
      problems.push("não foi possível ler as migrations do build (drizzle/) para validar a versão do schema");
    } else {
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM __drizzle_migrations WHERE hash = ?",
        [latest.hash],
      );
      if ((rows[0] as Cnt).cnt === 0) {
        problems.push(
          `migration mais recente não aplicada (${latest.tag}) — aplique o release (pnpm db:migrate:release) antes de iniciar`,
        );
      }
    }
  }

  // 2) Estruturas críticas — defesa adicional.
  for (const t of CRITICAL_TABLES) {
    if (!(await tableExists(t))) problems.push(`tabela crítica ausente: ${t}`);
  }
  for (const [t, c] of CRITICAL_COLUMNS) {
    // Só cobra a coluna se a tabela existe (ausência da tabela já foi registrada acima).
    if ((await tableExists(t)) && !(await columnExists(t, c))) {
      problems.push(`coluna crítica ausente: ${t}.${c}`);
    }
  }

  return problems;
}

export async function validateSchema(connection: mysql.Connection): Promise<void> {
  const problems = await collectSchemaProblems(connection);
  const level = decideSchemaValidation(problems, APP_CONFIG.isDevelopment);
  if (level === "ok") {
    log("DB", "✓ Schema validado (ledger aplicado + estruturas críticas presentes) — sem mutação em runtime");
    return;
  }

  const detail = problems.map((p) => `  • ${p}`).join("\n");
  const msg =
    `Schema incompatível com o esperado:\n${detail}\n` +
    `Nenhuma correção automática é aplicada em runtime (Fase B — RUNTIME & RELEASE SAFETY). ` +
    `Aplique as migrations versionadas com \`pnpm db:migrate:release\` e reinicie.`;

  if (level === "warn") {
    log("DB", `⚠ ${msg}`);
    return;
  }
  // staging/produção: FAIL-CLOSED — não ficar online em estado parcialmente compatível.
  throw new Error(`[bootstrap]${ENV_TAG} ${msg}`);
}

// ─── PR 0 (Security Emergency Closure) ─────────────────────────────────────────
// O bootstrap de admin de plataforma NÃO roda mais aqui. Antes, `seedAdmin` criava
// ou PROMOVIA a `role='admin'` — a CADA boot, em staging/produção — a conta cujo
// e-mail vinha de `ADMIN_EMAIL` com um default hardcoded para um e-mail pessoal de
// terceiro; e `seedDefaultOrgMembership` dava a TODO usuário `role='admin'` (não só
// o recém-criado) membership `owner` automática na organização 1. Quem controlasse
// esse e-mail (ou recuperasse a senha dele) virava admin de plataforma sem nenhuma
// ação deliberada. Substituído por um comando explícito e fail-closed —
// ver `scripts/bootstrap-admin.ts` (não roda no boot normal; invocação manual).

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all startup tasks before Express begins accepting requests.
 * Every step is idempotent — safe to call on every deploy.
 */
export async function bootstrap(): Promise<void> {
  // Step 0 — validar variáveis obrigatórias antes de qualquer conexão
  validateRequiredEnv();
  // Provider cognitivo (#159, fail-closed): AI_PROVIDER desconhecido, ou conhecido mas SEM adapter
  // operacional (claude/openai hoje), ou operacional SEM sua credencial → falha explícita no boot.
  validateAiProviderConfig(process.env);
  // Modelo de IA: sem allowlist rígida, mas bloqueia formato inválido/vazio e IDs
  // confirmadamente descontinuados — falha explícita no boot em vez de só na 1ª geração.
  validateAiRuntime({ provider: AI_CONFIG.provider, model: AI_CONFIG.model });

  console.info(
    `[BOOT]${ENV_TAG} Iniciando ${APP_CONFIG.name} v${APP_CONFIG.version}` +
    (APP_CONFIG.isStaging    ? " — ⚠️  STAGING" : "") +
    (APP_CONFIG.isDevelopment ? " — DEV"         : "")
  );

  log("CONFIG", `APP_ENV=${APP_ENV} | S3=${AWS_CONFIG.isConfigured ? "✓" : "✗"} | AI=${AI_CONFIG.isConfigured ? "✓" : "✗"} (${AI_CONFIG.provider}/${AI_CONFIG.model})`);

  const databaseUrl = process.env.DATABASE_URL!;
  const connection = await mysql.createConnection(databaseUrl);

  try {
    // APPLICATION START — o boot NÃO aplica migrations (nenhum migrator/DDL). A aplicação das
    // migrations é o passo de RELEASE, feito ANTES do start (Railway Pre-Deploy Command →
    // `pnpm db:migrate:release`; ver B-EXT1 no docs/ops/MIGRATION_RELEASE_RUNBOOK.md). Aqui o boot
    // apenas VALIDA o schema (não-mutável) e falha fechado em staging/produção se estiver
    // incompatível/atrás — o servidor só inicia após a validação passar.
    await validateSchema(connection);
  } finally {
    await connection.end();
  }

  log("OK", "Bootstrap concluído. Servidor pronto.");
}
