import path from "path";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users, organizations, organizationMembers } from "../drizzle/schema";
import type { RowDataPacket } from "mysql2";
import { APP_ENV, ENV_TAG, validateRequiredEnv } from "./config/env";
import { APP_CONFIG } from "./config/app";
import { AWS_CONFIG } from "./config/aws";
import { AI_CONFIG } from "./config/ai";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? "cardosomsales@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@123";
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? "Administrador";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Logging helper ───────────────────────────────────────────────────────────

function log(module: string, msg: string): void {
  console.info(`[BOOT]${ENV_TAG}[${module}] ${msg}`);
}

// ─── Step 1: run pending migrations ──────────────────────────────────────────

async function runMigrations(connection: mysql.Connection): Promise<void> {
  log("DB", `Executando migrações de: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  log("DB", "✓ Migrações aplicadas");
}

// ─── Step 2: ensure critical schema (safety net) ─────────────────────────────
// Guards against schema.ts changes that were never accompanied by a migration
// file. Each check is idempotent and safe to run on every startup.

async function ensureSchema(connection: mysql.Connection): Promise<void> {
  type ColRow = { cnt: number };

  async function addColumnIfMissing(
    table: string,
    column: string,
    definition: string
  ): Promise<void> {
    // Se a tabela não existe ainda, as migrations vão criá-la com o schema correto.
    const [tableRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = ?`,
      [table]
    );
    if ((tableRows[0] as ColRow).cnt === 0) return;

    const [colRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = ?
         AND COLUMN_NAME  = ?`,
      [table, column]
    );
    if ((colRows[0] as ColRow).cnt === 0) {
      await connection.execute(`ALTER TABLE \`${table}\` ADD \`${column}\` ${definition}`);
      log("DB", `✓ Schema corrigido: ${table}.${column} adicionada`);
    }
  }

  // Colunas pré-Sprint 1 (legacy)
  await addColumnIfMissing("users",     "passwordHash",    "varchar(255)");
  await addColumnIfMissing("documents", "sourceType",     "enum('ai','upload') NOT NULL DEFAULT 'ai'");
  await addColumnIfMissing("documents", "s3Key",          "varchar(500)");
  await addColumnIfMissing("documents", "fileUrl",        "varchar(1000)");
  await addColumnIfMissing("documents", "createdBy",      "int");
  await addColumnIfMissing("documents", "documentStatus", "enum('draft','in_review','approved','rejected') NOT NULL DEFAULT 'draft'");

  // Sprint 1 — Multi-tenant columns (zero-gap safety net)
  await addColumnIfMissing("processes",        "organizationId", "int");
  await addColumnIfMissing("documents",        "organizationId", "int");
  await addColumnIfMissing("tasks",            "organizationId", "int");
  await addColumnIfMissing("contracts",        "organizationId", "int");
  await addColumnIfMissing("direct_contracts", "organizationId", "int");
  await addColumnIfMissing("legal_opinions",   "organizationId", "int");
  await addColumnIfMissing("comments",         "organizationId", "int");
  await addColumnIfMissing("activity_logs",    "organizationId", "int");

  // Sprint 1 — Activity logs v2
  await addColumnIfMissing("activity_logs", "correlationId", "varchar(36)");
  await addColumnIfMissing("activity_logs", "requestId",     "varchar(36)");
  await addColumnIfMissing("activity_logs", "actorName",     "varchar(255)");
  await addColumnIfMissing("activity_logs", "entityType",    "varchar(50)");
  await addColumnIfMissing("activity_logs", "entityId",      "int");

  // Sprint 1.5 — ActivityLog hardening: snapshots imutáveis
  await addColumnIfMissing("activity_logs", "actorEmail",    "varchar(320)");
  await addColumnIfMissing("activity_logs", "actorRole",     "varchar(50)");
  await addColumnIfMissing("activity_logs", "orgName",       "varchar(255)");
  await addColumnIfMissing("activity_logs", "sourceContext", "enum('api','job','system','test','webhook') NOT NULL DEFAULT 'api'");
  await addColumnIfMissing("activity_logs", "ipAddress",     "varchar(45)");

  // Sprint 1.5 — Outbox envelope v2: actor + tenant context
  await addColumnIfMissing("outbox_events", "actorId",       "int");
  await addColumnIfMissing("outbox_events", "actorName",     "varchar(255)");
  await addColumnIfMissing("outbox_events", "tenantContext", "json");

  // Sprint 1.8 — Optimistic locking: version field em processes
  await addColumnIfMissing("processes", "version", "int NOT NULL DEFAULT 1");

  // Sprint 2 — Core Documental: extend documents
  await addColumnIfMissing("documents", "title",             "varchar(500)");
  await addColumnIfMissing("documents", "structuredContent", "json");
  await addColumnIfMissing("documents", "currentVersionId",  "int");
  await addColumnIfMissing("documents", "updatedBy",         "int");
  await addColumnIfMissing("documents", "approvedBy",        "int");
  await addColumnIfMissing("documents", "isLocked",          "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("documents", "lockedBy",          "int");
  await addColumnIfMissing("documents", "lockReason",        "varchar(255)");
  await addColumnIfMissing("documents", "lockExpiresAt",     "timestamp");
  await addColumnIfMissing("documents", "metadata",          "json");
  await addColumnIfMissing("documents", "archivedAt",        "timestamp");

  // Sprint 2 — Core Documental: extend comments
  await addColumnIfMissing("comments", "parentId",     "int");
  await addColumnIfMissing("comments", "anchorSection","varchar(100)");
  await addColumnIfMissing("comments", "status",       "enum('open','resolved','dismissed') NOT NULL DEFAULT 'open'");
  await addColumnIfMissing("comments", "resolvedBy",   "int");
  await addColumnIfMissing("comments", "resolvedAt",   "timestamp");
  await addColumnIfMissing("comments", "resolvedNote", "text");

  // Sprint 2 — Core Documental: extend document_templates
  await addColumnIfMissing("document_templates", "organizationId",    "int");
  await addColumnIfMissing("document_templates", "structuredContent", "json");
  await addColumnIfMissing("document_templates", "variables",         "json");
  await addColumnIfMissing("document_templates", "version",           "int NOT NULL DEFAULT 1");

  // Sprint 2.5 — Hardening Documental: integrity hashes em documents
  await addColumnIfMissing("documents", "contentHash",         "varchar(64)");
  await addColumnIfMissing("documents", "snapshotFingerprint", "varchar(64)");

  // Sprint 2.5 — Retention policy em documents
  await addColumnIfMissing("documents", "retentionClass", "varchar(50) NOT NULL DEFAULT 'operational_3years'");
  await addColumnIfMissing("documents", "legalHold",      "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("documents", "purgeAfter",     "timestamp NULL");

  // Sprint 2.5 — Integrity fingerprint em document_versions
  await addColumnIfMissing("document_versions", "snapshotFingerprint", "varchar(64)");

  // Sprint 2.8 — Import Sessions table (safety net para envs sem migração automática)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`import_sessions\` (
      \`id\`                INT          NOT NULL AUTO_INCREMENT,
      \`organizationId\`    INT          NOT NULL,
      \`uploadedBy\`        INT          NOT NULL,
      \`sourceFileId\`      VARCHAR(255) NOT NULL,
      \`sourceFileName\`    VARCHAR(255) NOT NULL,
      \`sourceMimeType\`    VARCHAR(100) NOT NULL,
      \`sourceSize\`        INT          NOT NULL DEFAULT 0,
      \`importType\`        VARCHAR(50)  NOT NULL DEFAULT 'generic',
      \`parserType\`        VARCHAR(20)  NOT NULL DEFAULT 'auto',
      \`parserVersion\`     VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
      \`status\`            ENUM('uploaded','queued','parsing','extracted','normalized','awaiting_review','approved','rejected','failed','archived') NOT NULL DEFAULT 'uploaded',
      \`progress\`          INT          NOT NULL DEFAULT 0,
      \`stage\`             VARCHAR(100),
      \`confidenceScore\`   DECIMAL(5,4),
      \`extractionSummary\` JSON,
      \`warnings\`          JSON,
      \`errors\`            JSON,
      \`correlationId\`     VARCHAR(36),
      \`retryCount\`        INT          NOT NULL DEFAULT 0,
      \`startedAt\`         TIMESTAMP    NULL,
      \`finishedAt\`        TIMESTAMP    NULL,
      \`failedAt\`          TIMESTAMP    NULL,
      \`createdAt\`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\`         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_import_sessions_org\`    (\`organizationId\`),
      INDEX \`idx_import_sessions_status\` (\`organizationId\`, \`status\`),
      INDEX \`idx_import_sessions_file\`   (\`organizationId\`, \`sourceFileId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.8 — Import Staging Items table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`import_staging_items\` (
      \`id\`                 INT          NOT NULL AUTO_INCREMENT,
      \`importSessionId\`    INT          NOT NULL,
      \`organizationId\`     INT          NOT NULL,
      \`rawDescription\`     TEXT,
      \`rawQuantity\`        VARCHAR(100),
      \`rawUnit\`            VARCHAR(50),
      \`rawUnitPrice\`       VARCHAR(100),
      \`rawTotalPrice\`      VARCHAR(100),
      \`rawMetadata\`        JSON,
      \`sourceLocation\`     JSON,
      \`parserMetadata\`     JSON,
      \`confidenceMetadata\` JSON,
      \`extractionWarnings\` JSON,
      \`extractionErrors\`   JSON,
      \`reviewStatus\`       ENUM('pending','approved','rejected','skipped') NOT NULL DEFAULT 'pending',
      \`reviewedBy\`         INT,
      \`reviewedAt\`         TIMESTAMP    NULL,
      \`reviewNote\`         TEXT,
      \`expiresAt\`          TIMESTAMP    NULL,
      \`createdAt\`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_staging_session\`  (\`importSessionId\`),
      INDEX \`idx_staging_org\`      (\`organizationId\`),
      INDEX \`idx_staging_review\`   (\`importSessionId\`, \`reviewStatus\`),
      INDEX \`idx_staging_expires\`  (\`expiresAt\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// ─── Step 3: seed admin user ──────────────────────────────────────────────────

async function seedAdmin(connection: mysql.Connection): Promise<void> {
  log("SEED", "Verificando usuário admin...");
  const db = drizzle(connection);

  const existing = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].role !== "admin") {
      await db.update(users).set({ role: "admin" }).where(eq(users.email, ADMIN_EMAIL));
      log("SEED", `✓ Admin promovido: ${ADMIN_EMAIL}`);
    } else {
      log("SEED", `✓ Admin já existe: ${ADMIN_EMAIL}`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.insert(users).values({
    openId: nanoid(),
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: "admin",
    passwordHash,
    loginMethod: "email",
    theme: "light",
  });
  log("SEED", `✓ Admin criado: ${ADMIN_EMAIL}`);
}

// ─── Step 4: seed admin membership na org padrão ────────────────────────────

async function seedDefaultOrgMembership(connection: mysql.Connection): Promise<void> {
  log("SEED", "Verificando membership do admin na org padrão...");
  const db = drizzle(connection);

  // Verificar se a tabela organizations existe (pode não existir em dev sem migrations)
  const [tables] = await connection.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations'"
  );
  if ((tables[0] as { cnt: number }).cnt === 0) {
    log("SEED", "Tabela organizations não existe ainda — pulando seed de membership");
    return;
  }

  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(10);

  for (const adminUser of adminUsers) {
    const existingMembership = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, 1),
        eq(organizationMembers.userId, adminUser.id),
      ))
      .limit(1);

    if (existingMembership.length === 0) {
      await db.insert(organizationMembers).values({
        organizationId: 1,
        userId: adminUser.id,
        role: "owner",
        ativo: true,
      });
      log("SEED", `✓ Membership owner criado para admin userId=${adminUser.id} na org padrão`);
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all startup tasks before Express begins accepting requests.
 * Every step is idempotent — safe to call on every deploy.
 */
export async function bootstrap(): Promise<void> {
  // Step 0 — validar variáveis obrigatórias antes de qualquer conexão
  validateRequiredEnv();

  console.info(
    `[BOOT]${ENV_TAG} Iniciando ${APP_CONFIG.name} v${APP_CONFIG.version}` +
    (APP_CONFIG.isStaging    ? " — ⚠️  STAGING" : "") +
    (APP_CONFIG.isDevelopment ? " — DEV"         : "")
  );

  log("CONFIG", `APP_ENV=${APP_ENV} | S3=${AWS_CONFIG.isConfigured ? "✓" : "✗"} | AI=${AI_CONFIG.isConfigured ? "✓" : "✗"}`);

  const databaseUrl = process.env.DATABASE_URL!;
  const connection = await mysql.createConnection(databaseUrl);

  try {
    await runMigrations(connection);
    await ensureSchema(connection);
    await seedAdmin(connection);
    await seedDefaultOrgMembership(connection);
  } finally {
    await connection.end();
  }

  log("OK", "Bootstrap concluído. Servidor pronto.");
}
