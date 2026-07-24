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
import { AI_CONFIG, validateAiRuntime } from "./config/ai";
import { ADMIN_PASSWORD as CONFIGURED_ADMIN_PASSWORD } from "./config/auth";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? "cardosomsales@gmail.com";
// RC-SEC-PR-A (CONFIG-005): sem default de produção. A resolução (obrigatória em
// produção/staging, fixture em dev) vem de config/auth.ts — sem default inseguro.
const ADMIN_PASSWORD = CONFIGURED_ADMIN_PASSWORD;
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? "Administrador";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Logging helper ───────────────────────────────────────────────────────────

function log(module: string, msg: string): void {
  console.info(`[BOOT]${ENV_TAG}[${module}] ${msg}`);
}

// ─── Step 1: run pending migrations ──────────────────────────────────────────

// Exportadas para o smoke test de reconciliação (reconciliation-mysql-smoke.test.ts),
// que exercita exatamente o que o boot roda: migrate() + ensureSchema() num MySQL real.
export async function runMigrations(connection: mysql.Connection): Promise<void> {
  log("DB", `Executando migrações de: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  log("DB", "✓ Migrações aplicadas");
}

// ─── Step 2: ensure critical schema (safety net) ─────────────────────────────
// Guards against schema.ts changes that were never accompanied by a migration
// file. Each check is idempotent and safe to run on every startup.

export async function ensureSchema(connection: mysql.Connection): Promise<void> {
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

  /**
   * PR A.1 — Índice UNIQUE em coluna de tabela preexistente.
   *
   * Diferente de uma coluna nova, um UNIQUE pode FALHAR por causa dos dados (duplicatas
   * legadas). Como isto roda em todo boot, uma falha aqui derrubaria a aplicação — então
   * verificamos as duplicatas antes e, havendo, apenas avisamos: a unicidade é aplicada
   * depois do saneamento (procedimento em docs/ops/EMAIL_BREVO_RUNBOOK.md). O sistema
   * continua correto sem o índice; ele é defesa em profundidade contra corrida no cadastro.
   */
  async function addUniqueIndexIfMissing(
    table: string,
    indexName: string,
    column: string
  ): Promise<void> {
    const [tableRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    if ((tableRows[0] as ColRow).cnt === 0) return;

    const [idxRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName]
    );
    if ((idxRows[0] as ColRow).cnt > 0) return;

    const [dupRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT \`${column}\` FROM \`${table}\`
         WHERE \`${column}\` IS NOT NULL
         GROUP BY \`${column}\` HAVING COUNT(*) > 1
       ) AS dups`
    );
    if ((dupRows[0] as ColRow).cnt > 0) {
      log("DB", `⚠ ${table}.${column}: ${(dupRows[0] as ColRow).cnt} valor(es) duplicado(s) — índice ${indexName} NÃO criado. Ver docs/ops/EMAIL_BREVO_RUNBOOK.md`);
      return;
    }

    await connection.execute(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${indexName}\` UNIQUE (\`${column}\`)`);
    log("DB", `✓ Schema corrigido: índice único ${indexName} criado em ${table}.${column}`);
  }

  // Colunas pré-Sprint 1 (legacy)
  await addColumnIfMissing("users",     "passwordHash",    "varchar(255)");
  // PR A.1 — revogação de sessão (claim `tv` do JWT) e unicidade do e-mail institucional.
  await addColumnIfMissing("users",     "tokenVersion",    "int NOT NULL DEFAULT 0");
  await addUniqueIndexIfMissing("users", "users_email_unique", "email");
  await addColumnIfMissing("documents", "sourceType",     "enum('ai','upload') NOT NULL DEFAULT 'ai'");
  await addColumnIfMissing("documents", "s3Key",          "varchar(500)");
  await addColumnIfMissing("documents", "fileUrl",        "varchar(1000)");
  await addColumnIfMissing("documents", "createdBy",      "int");
  await addColumnIfMissing("documents", "documentStatus", "enum('draft','in_review','approved','rejected') NOT NULL DEFAULT 'draft'");

  // SPRINT 5.3.1 — Contratos: metadados auditáveis de minuta + origem do aditivo.
  await addColumnIfMissing("contract_ws_documents", "metadata",       "TEXT NULL");
  await addColumnIfMissing("contract_addenda",      "request_origin", "varchar(30) NOT NULL DEFAULT 'contract_workspace'");

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

  // Sprint 2.9 — Import Review Transitions table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`import_review_transitions\` (
      \`id\`             VARCHAR(26)  NOT NULL,
      \`stagingItemId\`  VARCHAR(26)  NOT NULL,
      \`fromState\`      ENUM('extracted','normalized','review_pending','reviewed','approved','rejected','corrected','catmat_linked','finalized') NOT NULL,
      \`toState\`        ENUM('extracted','normalized','review_pending','reviewed','approved','rejected','corrected','catmat_linked','finalized') NOT NULL,
      \`actorType\`      ENUM('system','human','ai_assist') NOT NULL DEFAULT 'system',
      \`actorUserId\`    INT          NULL,
      \`actorOrgId\`     INT          NOT NULL,
      \`actorAgentId\`   VARCHAR(128) NULL,
      \`reason\`         TEXT         NULL,
      \`metadata\`       JSON         NULL,
      \`occurredAt\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_irt_staging_item\` (\`stagingItemId\`),
      INDEX \`idx_irt_to_state\`    (\`toState\`),
      INDEX \`idx_irt_org\`         (\`actorOrgId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.9 — Semantic Candidates table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`semantic_candidates\` (
      \`id\`                   VARCHAR(26)   NOT NULL,
      \`stagingItemId\`        VARCHAR(26)   NOT NULL,
      \`importSessionId\`      INT           NOT NULL,
      \`organizationId\`       INT           NOT NULL,
      \`proposedDescription\`  TEXT          NOT NULL,
      \`proposedUnit\`         VARCHAR(50)   NULL,
      \`proposedQuantity\`     DECIMAL(15,4) NULL,
      \`proposedUnitPrice\`    DECIMAL(15,4) NULL,
      \`score\`                DECIMAL(5,4)  NOT NULL,
      \`rank\`                 TINYINT       NOT NULL DEFAULT 1,
      \`source\`               ENUM('exact_match','alias_match','fuzzy_match','prefix_match','token_match','ngram_match','rule_based','catmat_lookup') NOT NULL,
      \`status\`               ENUM('pending','accepted','rejected','superseded','expired') NOT NULL DEFAULT 'pending',
      \`explanationReason\`    TEXT          NULL,
      \`explanationMatched\`   JSON          NULL,
      \`originalRaw\`          TEXT          NOT NULL,
      \`catmatCode\`           VARCHAR(20)   NULL,
      \`indexEntryId\`         VARCHAR(26)   NULL,
      \`generatedAt\`          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`evaluatedAt\`          DATETIME(3)   NULL,
      \`evaluatedBy\`          INT           NULL,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_sc_staging_item\` (\`stagingItemId\`),
      INDEX \`idx_sc_org\`         (\`organizationId\`),
      INDEX \`idx_sc_score\`       (\`score\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.9 — Extraction Evidence table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`extraction_evidence\` (
      \`id\`               VARCHAR(26) NOT NULL,
      \`stagingItemId\`    VARCHAR(26) NOT NULL,
      \`importSessionId\`  INT         NOT NULL,
      \`organizationId\`   INT         NOT NULL,
      \`chain\`            JSON        NOT NULL,
      \`createdAt\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`idx_ee_staging_item\` (\`stagingItemId\`),
      INDEX \`idx_ee_session\` (\`importSessionId\`),
      INDEX \`idx_ee_org\`     (\`organizationId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.9 — Semantic Search Entries table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`semantic_search_entries\` (
      \`id\`              VARCHAR(26)  NOT NULL,
      \`organizationId\`  INT          NOT NULL,
      \`canonicalText\`   TEXT         NOT NULL,
      \`displayText\`     TEXT         NOT NULL,
      \`category\`        VARCHAR(128) NULL,
      \`tokens\`          JSON         NOT NULL,
      \`aliases\`         JSON         NOT NULL,
      \`synonymTokens\`   JSON         NOT NULL,
      \`frequency\`       INT          NOT NULL DEFAULT 0,
      \`source\`          ENUM('manual','learned','catmat','imported') NOT NULL DEFAULT 'manual',
      \`catmatCode\`      VARCHAR(20)  NULL,
      \`isActive\`        TINYINT(1)   NOT NULL DEFAULT 1,
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_sse_org\`       (\`organizationId\`),
      INDEX \`idx_sse_catmat\`    (\`catmatCode\`),
      INDEX \`idx_sse_frequency\` (\`frequency\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.9 — Import Analytics Snapshots table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`import_analytics_snapshots\` (
      \`id\`              VARCHAR(26) NOT NULL,
      \`organizationId\`  INT         NOT NULL,
      \`periodStart\`     DATETIME(3) NOT NULL,
      \`periodEnd\`       DATETIME(3) NOT NULL,
      \`sessionCount\`    INT         NOT NULL DEFAULT 0,
      \`itemCount\`       INT         NOT NULL DEFAULT 0,
      \`kpis\`            JSON        NOT NULL,
      \`createdAt\`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ias_org\`    (\`organizationId\`),
      INDEX \`idx_ias_period\` (\`organizationId\`, \`periodStart\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Candidate Consensus table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`candidate_consensus\` (
      \`id\`                   VARCHAR(26)   NOT NULL,
      \`staging_item_id\`      VARCHAR(26)   NOT NULL,
      \`import_session_id\`    INT           NOT NULL,
      \`organization_id\`      INT           NOT NULL,
      \`winning_candidate_id\` VARCHAR(26)   NULL,
      \`consensus_score\`      DECIMAL(5,4)  NOT NULL,
      \`consensus_reasoning\`  TEXT          NOT NULL,
      \`confidence_breakdown\` JSON          NOT NULL,
      \`ranking_metadata\`     JSON          NOT NULL,
      \`evidence_summary\`     TEXT          NOT NULL,
      \`created_at\`           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cc_staging\` (\`staging_item_id\`),
      INDEX \`idx_cc_session\` (\`import_session_id\`),
      INDEX \`idx_cc_org\`     (\`organization_id\`),
      INDEX \`idx_cc_score\`   (\`consensus_score\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Review Decisions table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`review_decisions\` (
      \`id\`               VARCHAR(26)  NOT NULL,
      \`staging_item_id\`  VARCHAR(26)  NOT NULL,
      \`import_session_id\` INT         NOT NULL,
      \`organization_id\`  INT          NOT NULL,
      \`operation\`        ENUM('compare_candidates','approve_candidate','reject_candidate','override_candidate','request_manual_entry','request_new_search','attach_evidence','justify_decision','escalate_review') NOT NULL,
      \`actor_type\`       ENUM('system','human','ai_assist') NOT NULL DEFAULT 'human',
      \`actor_user_id\`    INT          NULL,
      \`actor_org_id\`     INT          NOT NULL,
      \`candidate_id\`     VARCHAR(26)  NULL,
      \`override_value\`   JSON         NULL,
      \`justification\`    TEXT         NOT NULL,
      \`evidence_refs\`    JSON         NOT NULL,
      \`escalate_to\`      INT          NULL,
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rd_staging\`   (\`staging_item_id\`),
      INDEX \`idx_rd_session\`   (\`import_session_id\`),
      INDEX \`idx_rd_org\`       (\`organization_id\`),
      INDEX \`idx_rd_operation\` (\`operation\`),
      INDEX \`idx_rd_actor\`     (\`actor_user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Semantic Drift Snapshots table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`semantic_drift_snapshots\` (
      \`id\`              VARCHAR(26) NOT NULL,
      \`organization_id\` INT         NOT NULL,
      \`period_start\`    DATETIME(3) NOT NULL,
      \`period_end\`      DATETIME(3) NOT NULL,
      \`metrics\`         JSON        NOT NULL,
      \`created_at\`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_sds_org\`    (\`organization_id\`),
      INDEX \`idx_sds_period\` (\`organization_id\`, \`period_start\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Catalog Sync Snapshots table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_sync_snapshots\` (
      \`id\`                 VARCHAR(26)   NOT NULL,
      \`organization_id\`    INT           NOT NULL,
      \`catalog_type\`       ENUM('catmat','catser','custom') NOT NULL,
      \`version\`            VARCHAR(50)   NOT NULL,
      \`source_url\`         VARCHAR(500)  NULL,
      \`checksum\`           VARCHAR(64)   NOT NULL,
      \`total_entries\`      INT           NOT NULL DEFAULT 0,
      \`indexed_entries\`    INT           NOT NULL DEFAULT 0,
      \`sync_status\`        ENUM('pending','syncing','synced','failed','stale') NOT NULL DEFAULT 'pending',
      \`snapshot_lineage\`   VARCHAR(26)   NULL,
      \`import_lineage\`     JSON          NOT NULL,
      \`integrity_metadata\` JSON          NOT NULL,
      \`cache_metadata\`     JSON          NOT NULL,
      \`created_at\`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_css_org\`     (\`organization_id\`),
      INDEX \`idx_css_type\`    (\`catalog_type\`),
      INDEX \`idx_css_status\`  (\`sync_status\`),
      INDEX \`idx_css_version\` (\`organization_id\`, \`version\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Catalog Sync History table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_sync_history\` (
      \`id\`              VARCHAR(26)  NOT NULL,
      \`snapshot_id\`     VARCHAR(26)  NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`operation\`       ENUM('create','update','verify','invalidate','expire') NOT NULL,
      \`before_version\`  VARCHAR(50)  NULL,
      \`after_version\`   VARCHAR(50)  NOT NULL,
      \`actor\`           VARCHAR(128) NOT NULL,
      \`reason\`          TEXT         NOT NULL,
      \`occurred_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_csh_snapshot\` (\`snapshot_id\`),
      INDEX \`idx_csh_org\`      (\`organization_id\`),
      INDEX \`idx_csh_occurred\` (\`occurred_at\` DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — Candidate Explainability table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`candidate_explainability\` (
      \`id\`                      VARCHAR(26) NOT NULL,
      \`candidate_id\`            VARCHAR(26) NOT NULL,
      \`staging_item_id\`         VARCHAR(26) NOT NULL,
      \`organization_id\`         INT         NOT NULL,
      \`why_suggested\`           TEXT        NOT NULL,
      \`why_ranked\`              TEXT        NOT NULL,
      \`why_rejected\`            TEXT        NULL,
      \`influencing_tokens\`      JSON        NOT NULL,
      \`aliases_used\`            JSON        NOT NULL,
      \`parser_influence\`        JSON        NOT NULL,
      \`normalization_influence\` JSON        NOT NULL,
      \`semantic_influence\`      JSON        NOT NULL,
      \`ranking_rationale\`       TEXT        NOT NULL,
      \`consensus_rationale\`     TEXT        NULL,
      \`confidence_rationale\`    TEXT        NOT NULL,
      \`generated_at\`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ce_candidate\` (\`candidate_id\`),
      INDEX \`idx_ce_staging\`   (\`staging_item_id\`),
      INDEX \`idx_ce_org\`       (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 2.95 — TR Composition Rules table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`tr_composition_rules\` (
      \`id\`              VARCHAR(26)  NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`name\`            VARCHAR(255) NOT NULL,
      \`condition_expr\`  TEXT         NOT NULL,
      \`action\`          ENUM('include_section','exclude_section','replace_clause','append_clause') NOT NULL,
      \`target_id\`       VARCHAR(26)  NOT NULL,
      \`priority\`        INT          NOT NULL DEFAULT 0,
      \`is_active\`       TINYINT(1)   NOT NULL DEFAULT 1,
      \`created_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_tcr_org\`      (\`organization_id\`),
      INDEX \`idx_tcr_priority\` (\`organization_id\`, \`priority\` DESC),
      INDEX \`idx_tcr_active\`   (\`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — ItemTR aggregate root table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`item_tr\` (
      \`id\`                       VARCHAR(64)  NOT NULL,
      \`organization_id\`          INT          NOT NULL,
      \`process_id\`               INT          NOT NULL,
      \`source_import_session_id\` INT          NULL,
      \`item_number\`              INT          NOT NULL,
      \`description\`              TEXT         NOT NULL,
      \`normalized_description\`   TEXT         NOT NULL,
      \`detailed_specification\`   TEXT         NULL,
      \`quantity\`                 DECIMAL(18,4) NOT NULL DEFAULT 0,
      \`unit\`                     VARCHAR(32)  NOT NULL,
      \`canonical_unit\`           VARCHAR(32)  NULL,
      \`estimated_unit_price\`     DECIMAL(18,4) NULL,
      \`estimated_total_price\`    DECIMAL(18,4) NULL,
      \`catmat_code\`              VARCHAR(32)  NULL,
      \`catmat_description\`       TEXT         NULL,
      \`catser_code\`              VARCHAR(32)  NULL,
      \`selected_candidate_id\`    VARCHAR(32)  NULL,
      \`consensus_id\`             VARCHAR(32)  NULL,
      \`confidence_score\`         DECIMAL(6,4) NOT NULL DEFAULT 0,
      \`review_state\`             ENUM('pending_match','candidate_generated','awaiting_review','approved','rejected','overridden','manual_entry','finalized') NOT NULL DEFAULT 'pending_match',
      \`approved_by\`              INT          NULL,
      \`approved_at\`              DATETIME(3)  NULL,
      \`evidence_ref\`             VARCHAR(64)  NULL,
      \`provenance\`               JSON         NOT NULL,
      \`warnings\`                 JSON         NOT NULL,
      \`metadata\`                 JSON         NOT NULL,
      \`correlation_id\`           VARCHAR(64)  NULL,
      \`created_at\`               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_itemtr_org\`     (\`organization_id\`),
      INDEX \`idx_itemtr_process\` (\`organization_id\`, \`process_id\`),
      INDEX \`idx_itemtr_number\`  (\`organization_id\`, \`process_id\`, \`item_number\`),
      INDEX \`idx_itemtr_state\`   (\`organization_id\`, \`review_state\`),
      INDEX \`idx_itemtr_catmat\`  (\`organization_id\`, \`catmat_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Item Review History table (append-only)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`item_review_history\` (
      \`id\`              VARCHAR(32) NOT NULL,
      \`item_id\`         VARCHAR(64) NOT NULL,
      \`organization_id\` INT         NOT NULL,
      \`from_state\`      ENUM('pending_match','candidate_generated','awaiting_review','approved','rejected','overridden','manual_entry','finalized') NOT NULL,
      \`to_state\`        ENUM('pending_match','candidate_generated','awaiting_review','approved','rejected','overridden','manual_entry','finalized') NOT NULL,
      \`actor_type\`      ENUM('system','human','ai_assist') NOT NULL,
      \`actor_user_id\`   INT         NULL,
      \`actor_email\`     VARCHAR(255) NULL,
      \`reason\`          TEXT        NULL,
      \`justification\`   TEXT        NULL,
      \`evidence_refs\`   JSON        NOT NULL,
      \`metadata\`        JSON        NULL,
      \`correlation_id\`  VARCHAR(64) NULL,
      \`occurred_at\`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_irh_org\`      (\`organization_id\`),
      INDEX \`idx_irh_item\`     (\`organization_id\`, \`item_id\`),
      INDEX \`idx_irh_state\`    (\`organization_id\`, \`to_state\`),
      INDEX \`idx_irh_occurred\` (\`item_id\`, \`occurred_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Catalog Snapshots table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_snapshots\` (
      \`id\`                 VARCHAR(32) NOT NULL,
      \`organization_id\`    INT         NOT NULL,
      \`catalog_type\`       ENUM('catmat','catser','custom') NOT NULL,
      \`version\`            VARCHAR(50) NOT NULL,
      \`checksum\`           VARCHAR(64) NOT NULL,
      \`total_entries\`      INT         NOT NULL DEFAULT 0,
      \`indexed_entries\`    INT         NOT NULL DEFAULT 0,
      \`sync_status\`        ENUM('pending','syncing','synced','failed','stale') NOT NULL DEFAULT 'pending',
      \`snapshot_lineage\`   VARCHAR(32) NULL,
      \`import_lineage\`     JSON        NOT NULL,
      \`integrity_metadata\` JSON        NOT NULL,
      \`cache_metadata\`     JSON        NOT NULL,
      \`correlation_id\`     VARCHAR(64) NULL,
      \`created_at\`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cs_org\`      (\`organization_id\`),
      INDEX \`idx_cs_type\`     (\`organization_id\`, \`catalog_type\`),
      INDEX \`idx_cs_status\`   (\`organization_id\`, \`sync_status\`),
      INDEX \`idx_cs_checksum\` (\`checksum\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Catalog Entries table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_entries\` (
      \`id\`                     VARCHAR(32) NOT NULL,
      \`organization_id\`        INT         NOT NULL,
      \`code\`                   VARCHAR(32) NOT NULL,
      \`catalog_type\`           ENUM('catmat','catser') NOT NULL,
      \`description\`            TEXT        NOT NULL,
      \`normalized_description\` TEXT        NOT NULL,
      \`unit\`                   VARCHAR(32) NULL,
      \`canonical_unit\`         VARCHAR(32) NULL,
      \`catalog_group\`          VARCHAR(255) NULL,
      \`aliases\`                JSON        NOT NULL,
      \`tokens\`                 JSON        NOT NULL,
      \`active\`                 TINYINT(1)  NOT NULL DEFAULT 1,
      \`snapshot_id\`            VARCHAR(32) NULL,
      \`created_at\`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cat_org\`    (\`organization_id\`),
      INDEX \`idx_cat_code\`   (\`organization_id\`, \`code\`),
      INDEX \`idx_cat_type\`   (\`organization_id\`, \`catalog_type\`),
      INDEX \`idx_cat_active\` (\`organization_id\`, \`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Clause Templates table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`clause_templates\` (
      \`id\`              VARCHAR(32)  NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`clause_type\`     ENUM('header','body','item_list','legal_basis','justification','specification','price_ref','footer') NOT NULL,
      \`title\`           VARCHAR(255) NOT NULL,
      \`content\`         TEXT         NOT NULL,
      \`legal_basis\`     VARCHAR(255) NULL,
      \`priority\`        INT          NOT NULL DEFAULT 0,
      \`applies_to\`      JSON         NOT NULL,
      \`base_relevance\`  DECIMAL(6,4) NOT NULL DEFAULT 0,
      \`is_active\`       TINYINT(1)   NOT NULL DEFAULT 1,
      \`created_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ct_org\`      (\`organization_id\`),
      INDEX \`idx_ct_type\`     (\`organization_id\`, \`clause_type\`),
      INDEX \`idx_ct_priority\` (\`organization_id\`, \`priority\` DESC),
      INDEX \`idx_ct_active\`   (\`organization_id\`, \`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — TR Compositions table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`tr_compositions\` (
      \`id\`                    VARCHAR(32) NOT NULL,
      \`organization_id\`       INT         NOT NULL,
      \`process_id\`            INT         NOT NULL,
      \`replay_key\`            VARCHAR(64) NOT NULL,
      \`correlation_id\`        VARCHAR(64) NULL,
      \`composed_sections\`     JSON        NOT NULL,
      \`recommended_clauses\`   JSON        NOT NULL,
      \`item_groups\`           JSON        NOT NULL,
      \`composition_rationale\` TEXT        NOT NULL,
      \`item_count\`            INT         NOT NULL DEFAULT 0,
      \`created_by\`            INT         NULL,
      \`created_at\`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_trc_org\`     (\`organization_id\`),
      INDEX \`idx_trc_process\` (\`organization_id\`, \`process_id\`),
      INDEX \`idx_trc_replay\`  (\`organization_id\`, \`replay_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Item Candidate Links table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`item_candidate_links\` (
      \`id\`                VARCHAR(32) NOT NULL,
      \`organization_id\`   INT         NOT NULL,
      \`item_id\`           VARCHAR(64) NOT NULL,
      \`candidate_id\`      VARCHAR(32) NOT NULL,
      \`staging_item_id\`   VARCHAR(26) NULL,
      \`import_session_id\` INT         NULL,
      \`score\`             DECIMAL(6,4) NOT NULL DEFAULT 0,
      \`candidate_rank\`    INT         NOT NULL DEFAULT 1,
      \`source\`            VARCHAR(32) NOT NULL,
      \`status\`            ENUM('pending','accepted','rejected','superseded','expired') NOT NULL DEFAULT 'pending',
      \`catmat_code\`       VARCHAR(32) NULL,
      \`is_selected\`       TINYINT(1)  NOT NULL DEFAULT 0,
      \`replay_key\`        VARCHAR(64) NULL,
      \`correlation_id\`    VARCHAR(64) NULL,
      \`created_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_icl_org\`       (\`organization_id\`),
      INDEX \`idx_icl_item\`      (\`organization_id\`, \`item_id\`),
      INDEX \`idx_icl_candidate\` (\`candidate_id\`),
      INDEX \`idx_icl_selected\`  (\`organization_id\`, \`item_id\`, \`is_selected\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.0 — Item Explainability table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`item_explainability\` (
      \`id\`                      VARCHAR(32) NOT NULL,
      \`organization_id\`         INT         NOT NULL,
      \`item_id\`                 VARCHAR(64) NOT NULL,
      \`candidate_id\`            VARCHAR(32) NOT NULL,
      \`why_suggested\`           TEXT        NOT NULL,
      \`why_ranked\`              TEXT        NOT NULL,
      \`why_rejected\`            TEXT        NULL,
      \`influencing_tokens\`      JSON        NOT NULL,
      \`parser_influence\`        JSON        NOT NULL,
      \`normalization_influence\` JSON        NOT NULL,
      \`semantic_influence\`      JSON        NOT NULL,
      \`ranking_rationale\`       TEXT        NOT NULL,
      \`consensus_rationale\`     TEXT        NULL,
      \`confidence_rationale\`    TEXT        NOT NULL,
      \`replay_key\`              VARCHAR(64) NULL,
      \`correlation_id\`          VARCHAR(64) NULL,
      \`generated_at\`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_iexp_org\`       (\`organization_id\`),
      INDEX \`idx_iexp_item\`      (\`organization_id\`, \`item_id\`),
      INDEX \`idx_iexp_candidate\` (\`candidate_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Catalog Ingestion Jobs table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_ingestion_jobs\` (
      \`id\`                  VARCHAR(32) NOT NULL,
      \`organization_id\`     INT         NOT NULL,
      \`catalog_type\`        ENUM('catmat','catser') NOT NULL,
      \`status\`              ENUM('pending','processing','completed','failed','partial') NOT NULL DEFAULT 'pending',
      \`total_entries\`       INT         NOT NULL DEFAULT 0,
      \`processed_entries\`   INT         NOT NULL DEFAULT 0,
      \`failed_entries\`      INT         NOT NULL DEFAULT 0,
      \`duplicates_skipped\`  INT         NOT NULL DEFAULT 0,
      \`snapshot_id\`         VARCHAR(32) NULL,
      \`correlation_id\`      VARCHAR(64) NULL,
      \`resume_token\`        VARCHAR(255) NULL,
      \`checksum_before\`     VARCHAR(64) NOT NULL,
      \`checksum_after\`      VARCHAR(64) NULL,
      \`started_at\`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`completed_at\`        DATETIME(3) NULL,
      \`errors\`              JSON        NULL,
      \`created_at\`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cij_org\`    (\`organization_id\`),
      INDEX \`idx_cij_status\` (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Distributed Cache Entries table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`distributed_cache_entries\` (
      \`key\`                VARCHAR(512) NOT NULL,
      \`organization_id\`    INT          NOT NULL,
      \`value\`              JSON         NOT NULL,
      \`ttl_ms\`             INT          NOT NULL DEFAULT 300000,
      \`snapshot_version\`   VARCHAR(64)  NULL,
      \`created_at\`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`expires_at\`         DATETIME(3)  NOT NULL,
      PRIMARY KEY (\`organization_id\`, \`key\`),
      INDEX \`idx_dce_expires\` (\`expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Official Exports table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`official_exports\` (
      \`id\`                VARCHAR(64) NOT NULL,
      \`organization_id\`   INT         NOT NULL,
      \`process_id\`        INT         NOT NULL,
      \`format\`            ENUM('docx','pdf') NOT NULL,
      \`filename\`          VARCHAR(255) NOT NULL,
      \`content_hash\`      VARCHAR(64)  NOT NULL,
      \`page_count\`        INT          NOT NULL DEFAULT 1,
      \`template_id\`       VARCHAR(64)  NULL,
      \`watermark\`         VARCHAR(255) NULL,
      \`correlation_id\`    VARCHAR(64)  NULL,
      \`generated_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_oe_org\`     (\`organization_id\`),
      INDEX \`idx_oe_process\` (\`organization_id\`, \`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Institutional Workflows table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`institutional_workflows\` (
      \`id\`                VARCHAR(64) NOT NULL,
      \`organization_id\`   INT         NOT NULL,
      \`process_id\`        INT         NOT NULL,
      \`current_stage\`     ENUM('elaboration','technical_review','legal_review','authority_approval','director_approval','publication','completed','cancelled') NOT NULL DEFAULT 'elaboration',
      \`stages\`            JSON        NOT NULL,
      \`assigned_to\`       JSON        NOT NULL,
      \`deadlines\`         JSON        NOT NULL,
      \`escalation_rules\`  JSON        NOT NULL,
      \`status\`            VARCHAR(32) NOT NULL DEFAULT 'active',
      \`correlation_id\`    VARCHAR(64) NULL,
      \`created_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_iw_org\`     (\`organization_id\`),
      INDEX \`idx_iw_process\` (\`organization_id\`, \`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Operational Audit Events table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`operational_audit_events\` (
      \`id\`                VARCHAR(64)  NOT NULL,
      \`organization_id\`   INT          NOT NULL,
      \`category\`          ENUM('export','approval','override','clause_change','item_change','semantic_override','workflow_transition','tenant_operation') NOT NULL,
      \`action\`            VARCHAR(255) NOT NULL,
      \`actor_id\`          INT          NOT NULL,
      \`actor_role\`        VARCHAR(100) NOT NULL,
      \`target_type\`       VARCHAR(100) NOT NULL,
      \`target_id\`         VARCHAR(100) NOT NULL,
      \`before_state\`      JSON         NULL,
      \`after_state\`       JSON         NULL,
      \`justification\`     TEXT         NULL,
      \`correlation_id\`    VARCHAR(64)  NULL,
      \`occurred_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_oae_org_cat\`    (\`organization_id\`, \`category\`),
      INDEX \`idx_oae_org_target\` (\`organization_id\`, \`target_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Tenant Integrity Reports table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`tenant_integrity_reports\` (
      \`id\`                VARCHAR(64) NOT NULL,
      \`organization_id\`   INT         NOT NULL,
      \`scan_type\`         VARCHAR(64) NOT NULL,
      \`findings_count\`    INT         NOT NULL DEFAULT 0,
      \`healthy\`           TINYINT(1)  NOT NULL DEFAULT 1,
      \`findings\`          JSON        NOT NULL,
      \`scanned_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_tir_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Security Incidents table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`security_incidents\` (
      \`id\`                VARCHAR(64) NOT NULL,
      \`organization_id\`   INT         NOT NULL,
      \`event_type\`        ENUM('brute_force','suspicious_access','permission_anomaly','session_anomaly','audit_anomaly','rate_limit_exceeded') NOT NULL,
      \`severity\`          ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
      \`actor_id\`          INT         NULL,
      \`description\`       TEXT        NOT NULL,
      \`metadata\`          JSON        NULL,
      \`correlation_id\`    VARCHAR(64) NULL,
      \`detected_at\`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_si_org_type\`     (\`organization_id\`, \`event_type\`),
      INDEX \`idx_si_org_severity\` (\`organization_id\`, \`severity\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.2 — Catalog Snapshots V2 table
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`catalog_snapshots_v2\` (
      \`id\`                   VARCHAR(64)  NOT NULL,
      \`organization_id\`      INT          NOT NULL,
      \`catalog_type\`         ENUM('catmat','catser','custom') NOT NULL,
      \`version\`              VARCHAR(50)  NOT NULL,
      \`total_entries\`        INT          NOT NULL DEFAULT 0,
      \`indexed_entries\`      INT          NOT NULL DEFAULT 0,
      \`checksum\`             VARCHAR(64)  NOT NULL,
      \`previous_snapshot_id\` VARCHAR(64)  NULL,
      \`ingestion_job_id\`     VARCHAR(32)  NULL,
      \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_csv2_org_type\` (\`organization_id\`, \`catalog_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Collaboration Comments
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`collaboration_comments\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`entityType\`       VARCHAR(50)   NOT NULL,
      \`entityId\`         VARCHAR(64)   NOT NULL,
      \`threadId\`         VARCHAR(64)   NULL,
      \`content\`          TEXT          NOT NULL,
      \`authorId\`         INT           NOT NULL,
      \`authorName\`       VARCHAR(255)  NOT NULL,
      \`mentions\`         JSON          NOT NULL,
      \`status\`           ENUM('active','resolved','deleted') NOT NULL DEFAULT 'active',
      \`editHistoryJson\`  JSON          NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_cc_org_entity\` (\`organizationId\`, \`entityId\`),
      INDEX \`idx_cc_org_thread\` (\`organizationId\`, \`threadId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Discussion Threads
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`discussion_threads\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`entityType\`       VARCHAR(50)   NOT NULL,
      \`entityId\`         VARCHAR(64)   NOT NULL,
      \`title\`            VARCHAR(500)  NOT NULL,
      \`status\`           ENUM('open','resolved') NOT NULL DEFAULT 'open',
      \`resolvedBy\`       INT           NULL,
      \`resolvedAt\`       DATETIME(3)   NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_dt_org_entity\` (\`organizationId\`, \`entityId\`),
      INDEX \`idx_dt_org_status\` (\`organizationId\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Webhook Deliveries
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`webhook_deliveries\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`endpointId\`       VARCHAR(64)   NOT NULL,
      \`eventType\`        VARCHAR(100)  NOT NULL,
      \`payloadJson\`      JSON          NOT NULL,
      \`signature\`        VARCHAR(256)  NOT NULL,
      \`status\`           ENUM('pending','delivered','failed','dead_letter') NOT NULL DEFAULT 'pending',
      \`attempts\`         INT           NOT NULL DEFAULT 0,
      \`lastError\`        TEXT          NULL,
      \`correlationId\`    VARCHAR(64)   NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`deliveredAt\`      DATETIME(3)   NULL,
      INDEX \`idx_wd_org_event\`  (\`organizationId\`, \`eventType\`),
      INDEX \`idx_wd_org_status\` (\`organizationId\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Public API Tokens
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`public_api_tokens\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`name\`             VARCHAR(255)  NOT NULL,
      \`tokenHash\`        VARCHAR(255)  NOT NULL,
      \`scopes\`           JSON          NOT NULL,
      \`active\`           BOOLEAN       NOT NULL DEFAULT TRUE,
      \`expiresAt\`        DATETIME(3)   NULL,
      \`lastUsedAt\`       DATETIME(3)   NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_pat_org_active\` (\`organizationId\`, \`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Document Version Diffs
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`document_version_diffs\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`entityType\`       VARCHAR(50)   NOT NULL,
      \`entityId\`         VARCHAR(64)   NOT NULL,
      \`fromVersionId\`    VARCHAR(64)   NOT NULL,
      \`toVersionId\`      VARCHAR(64)   NOT NULL,
      \`changesJson\`      JSON          NOT NULL,
      \`summary\`          VARCHAR(500)  NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_dvd_org_entity\` (\`organizationId\`, \`entityId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — External Storage Snapshots
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`external_storage_snapshots\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`adapterId\`        VARCHAR(64)   NOT NULL,
      \`totalFiles\`       INT           NOT NULL DEFAULT 0,
      \`syncedFiles\`      INT           NOT NULL DEFAULT 0,
      \`conflictsCount\`   INT           NOT NULL DEFAULT 0,
      \`checksum\`         VARCHAR(255)  NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ess_org_adapter\` (\`organizationId\`, \`adapterId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Structured Exports
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`structured_exports\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`schema\`           VARCHAR(100)  NOT NULL,
      \`format\`           VARCHAR(20)   NOT NULL,
      \`version\`          VARCHAR(20)   NOT NULL DEFAULT '1.0',
      \`payloadJson\`      JSON          NOT NULL,
      \`checksum\`         VARCHAR(255)  NOT NULL,
      \`correlationId\`    VARCHAR(64)   NOT NULL,
      \`generatedAt\`      DATETIME(3)   NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_se_org_schema\` (\`organizationId\`, \`schema\`),
      INDEX \`idx_se_org_format\` (\`organizationId\`, \`format\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Sprint 3.3 — Communication Events
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`communication_events\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organizationId\`   INT           NOT NULL,
      \`recipientUserId\`  INT           NOT NULL,
      \`senderUserId\`     INT           NULL,
      \`type\`             VARCHAR(100)  NOT NULL,
      \`priority\`         VARCHAR(20)   NOT NULL DEFAULT 'normal',
      \`title\`            VARCHAR(500)  NOT NULL,
      \`message\`          TEXT          NOT NULL,
      \`entityType\`       VARCHAR(50)   NULL,
      \`entityId\`         VARCHAR(64)   NULL,
      \`readStatus\`       BOOLEAN       NOT NULL DEFAULT FALSE,
      \`readAt\`           DATETIME(3)   NULL,
      \`correlationId\`    VARCHAR(64)   NOT NULL,
      \`createdAt\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ce_org_recipient\` (\`organizationId\`, \`recipientUserId\`),
      INDEX \`idx_ce_org_type\`      (\`organizationId\`, \`type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ─── Sprint 3.4 ─────────────────────────────────────────────────────────────

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`operational_templates\` (
      \`id\`                     VARCHAR(128)  NOT NULL,
      \`organization_id\`        INT           NOT NULL DEFAULT 0,
      \`category\`               VARCHAR(64)   NOT NULL,
      \`name\`                   VARCHAR(256)  NOT NULL,
      \`description\`            TEXT          NOT NULL,
      \`clause_templates\`       JSON          NOT NULL,
      \`item_tr_templates\`      JSON          NOT NULL,
      \`workflow_template\`      JSON          NOT NULL,
      \`legal_basis\`            JSON          NOT NULL,
      \`estimated_duration_days\` INT          NOT NULL DEFAULT 30,
      \`approval_levels\`        INT           NOT NULL DEFAULT 2,
      \`version\`                VARCHAR(32)   NOT NULL DEFAULT '1.0.0',
      \`version_history\`        JSON          NOT NULL,
      \`active\`                 TINYINT(1)    NOT NULL DEFAULT 1,
      \`createdAt\`              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`              DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_opt_org\` (\`organization_id\`),
      INDEX \`idx_opt_cat\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`pilot_organizations\` (
      \`id\`                  VARCHAR(128) NOT NULL,
      \`organization_id\`     INT          NOT NULL,
      \`municipio\`           VARCHAR(256) NOT NULL,
      \`estado\`              CHAR(2)      NOT NULL,
      \`populacao\`           INT          NOT NULL DEFAULT 0,
      \`pilot_phase\`         VARCHAR(32)  NOT NULL DEFAULT 'onboarding',
      \`pilot_started_at\`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`pilot_go_live_at\`    DATETIME(3)  NULL,
      \`rollout_percentage\`  INT          NOT NULL DEFAULT 0,
      \`features\`            JSON         NOT NULL,
      \`metrics\`             JSON         NOT NULL,
      \`health\`              JSON         NOT NULL,
      \`audit_trail\`         JSON         NOT NULL,
      \`createdAt\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_pilot_org\` (\`organization_id\`),
      INDEX \`idx_pilot_phase\` (\`pilot_phase\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`department_permissions\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_id\`         INT          NOT NULL,
      \`department\`      VARCHAR(128) NOT NULL,
      \`resource\`        VARCHAR(64)  NOT NULL,
      \`actions\`         JSON         NOT NULL,
      \`scope\`           VARCHAR(32)  NOT NULL DEFAULT 'own',
      \`granted_by\`      INT          NOT NULL,
      \`granted_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`expires_at\`      DATETIME(3)  NULL,
      \`active\`          TINYINT(1)   NOT NULL DEFAULT 1,
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_dp_org_user\` (\`organization_id\`, \`user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`workflow_permissions\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_id\`         INT          NOT NULL,
      \`workflow_stage\`  VARCHAR(64)  NOT NULL,
      \`can_advance\`     TINYINT(1)   NOT NULL DEFAULT 0,
      \`can_reject\`      TINYINT(1)   NOT NULL DEFAULT 0,
      \`can_escalate\`    TINYINT(1)   NOT NULL DEFAULT 0,
      \`can_delegate\`    TINYINT(1)   NOT NULL DEFAULT 0,
      \`max_delegations\` INT          NOT NULL DEFAULT 1,
      \`granted_by\`      INT          NOT NULL,
      \`granted_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_wp_org_user\` (\`organization_id\`, \`user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`environments\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`name\`            VARCHAR(256) NOT NULL,
      \`type\`            VARCHAR(32)  NOT NULL DEFAULT 'development',
      \`status\`          VARCHAR(32)  NOT NULL DEFAULT 'active',
      \`config\`          JSON         NOT NULL,
      \`version\`         VARCHAR(32)  NOT NULL DEFAULT '1.0.0',
      \`promoted_from\`   VARCHAR(128) NULL,
      \`created_by\`      INT          NOT NULL,
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_env_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`environment_promotions\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`from_env_id\`     VARCHAR(128) NOT NULL,
      \`to_env_id\`       VARCHAR(128) NOT NULL,
      \`promoted_by\`     INT          NOT NULL,
      \`changes\`         JSON         NOT NULL,
      \`promoted_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_envp_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`ux_events\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_id\`         INT          NOT NULL,
      \`session_id\`      VARCHAR(128) NOT NULL,
      \`event_type\`      VARCHAR(64)  NOT NULL,
      \`feature\`         VARCHAR(128) NOT NULL,
      \`metadata\`        JSON         NOT NULL,
      \`duration_ms\`     INT          NULL,
      \`occurred_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ux_org\`     (\`organization_id\`),
      INDEX \`idx_ux_session\` (\`session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`ux_sessions\` (
      \`session_id\`        VARCHAR(128) NOT NULL,
      \`organization_id\`   INT          NOT NULL,
      \`user_id\`           INT          NOT NULL,
      \`started_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`ended_at\`          DATETIME(3)  NULL,
      \`events_count\`      INT          NOT NULL DEFAULT 0,
      \`features_used\`     JSON         NOT NULL,
      \`total_duration_ms\` INT          NOT NULL DEFAULT 0,
      \`createdAt\`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`session_id\`),
      INDEX \`idx_uxs_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`readiness_reports\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`pilot_phase\`     VARCHAR(32)  NOT NULL,
      \`overall_score\`   INT          NOT NULL DEFAULT 0,
      \`overall_status\`  VARCHAR(32)  NOT NULL DEFAULT 'not_ready',
      \`checks\`          JSON         NOT NULL,
      \`blockers\`        JSON         NOT NULL,
      \`recommendations\` JSON         NOT NULL,
      \`generated_at\`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rr_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`phase_transition_approvals\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`from_phase\`      VARCHAR(32)  NOT NULL,
      \`to_phase\`        VARCHAR(32)  NOT NULL,
      \`approved_by\`     INT          NOT NULL,
      \`readiness_score\` INT          NOT NULL DEFAULT 0,
      \`notes\`           TEXT         NOT NULL,
      \`approved_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_pta_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`permission_audit_log\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_id\`         INT          NOT NULL,
      \`action\`          VARCHAR(64)  NOT NULL,
      \`resource\`        VARCHAR(64)  NOT NULL,
      \`resource_id\`     VARCHAR(256) NOT NULL,
      \`allowed\`         TINYINT(1)   NOT NULL DEFAULT 0,
      \`reason\`          VARCHAR(512) NOT NULL,
      \`occurred_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_pal_org\`  (\`organization_id\`),
      INDEX \`idx_pal_user\` (\`user_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`workflow_analytics_snapshots\` (
      \`id\`                    VARCHAR(128) NOT NULL,
      \`organization_id\`       INT          NOT NULL,
      \`period_start\`          DATETIME(3)  NOT NULL,
      \`period_end\`            DATETIME(3)  NOT NULL,
      \`total_processes\`       INT          NOT NULL DEFAULT 0,
      \`completed_processes\`   INT          NOT NULL DEFAULT 0,
      \`avg_completion_days\`   DECIMAL(10,2) NOT NULL DEFAULT 0,
      \`bottleneck_stages\`     JSON         NOT NULL,
      \`drop_off_points\`       JSON         NOT NULL,
      \`user_engagement_score\` INT          NOT NULL DEFAULT 0,
      \`computed_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_was_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ─── Sprint 3.5 ─────────────────────────────────────────────────────────────

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`pilot_execution_snapshots\` (
      \`id\`               VARCHAR(128) NOT NULL,
      \`organization_id\`  INT          NOT NULL,
      \`municipio\`        VARCHAR(256) NOT NULL,
      \`activation_state\` VARCHAR(64)  NOT NULL DEFAULT 'inactive',
      \`maturity_level\`   VARCHAR(32)  NOT NULL DEFAULT 'initial',
      \`adoption_score\`   JSON         NOT NULL,
      \`health_indicators\` JSON        NOT NULL,
      \`risk_indicators\`  JSON         NOT NULL,
      \`rollout_stages\`   JSON         NOT NULL,
      \`execution_history\` JSON        NOT NULL,
      \`started_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`last_activity_at\` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_pes_org\`   (\`organization_id\`),
      INDEX \`idx_pes_state\` (\`activation_state\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`operational_feedback\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_hash\`       VARCHAR(32)  NOT NULL,
      \`category\`        VARCHAR(64)  NOT NULL,
      \`severity\`        VARCHAR(16)  NOT NULL DEFAULT 'low',
      \`feature\`         VARCHAR(256) NOT NULL,
      \`message\`         TEXT         NOT NULL,
      \`rating\`          TINYINT      NULL,
      \`metadata\`        JSON         NOT NULL,
      \`collected_at\`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_of_org\`      (\`organization_id\`),
      INDEX \`idx_of_category\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`workload_metrics\` (
      \`id\`                       VARCHAR(128) NOT NULL,
      \`organization_id\`          INT          NOT NULL,
      \`period_start\`             DATETIME(3)  NOT NULL,
      \`period_end\`               DATETIME(3)  NOT NULL,
      \`reviewer_workloads\`       JSON         NOT NULL,
      \`alerts\`                   JSON         NOT NULL,
      \`queue_health\`             JSON         NOT NULL,
      \`avg_approval_latency_ms\`  INT          NOT NULL DEFAULT 0,
      \`total_pending\`            INT          NOT NULL DEFAULT 0,
      \`throughput_per_hour\`      DECIMAL(10,4) NOT NULL DEFAULT 0,
      \`productivity_score\`       INT          NOT NULL DEFAULT 100,
      \`computed_at\`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`                DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_wm_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`support_incidents\` (
      \`id\`                  VARCHAR(128) NOT NULL,
      \`organization_id\`     INT          NOT NULL,
      \`title\`               VARCHAR(512) NOT NULL,
      \`description\`         TEXT         NOT NULL,
      \`severity\`            VARCHAR(16)  NOT NULL DEFAULT 'low',
      \`category\`            VARCHAR(32)  NOT NULL,
      \`status\`              VARCHAR(32)  NOT NULL DEFAULT 'open',
      \`reported_by\`         INT          NOT NULL,
      \`assigned_to\`         INT          NULL,
      \`escalations\`         JSON         NOT NULL,
      \`history\`             JSON         NOT NULL,
      \`related_process_ids\` JSON         NOT NULL,
      \`resolution\`          TEXT         NULL,
      \`resolved_at\`         DATETIME(3)  NULL,
      \`closed_at\`           DATETIME(3)  NULL,
      \`createdAt\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updatedAt\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_si_org\`      (\`organization_id\`),
      INDEX \`idx_si_severity\` (\`severity\`),
      INDEX \`idx_si_status\`   (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`pilot_readiness_scores\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`total_score\`     INT          NOT NULL DEFAULT 0,
      \`tier\`            VARCHAR(16)  NOT NULL DEFAULT 'not_ready',
      \`dimensions\`      JSON         NOT NULL,
      \`replay_key\`      VARCHAR(64)  NOT NULL,
      \`recommendations\` JSON         NOT NULL,
      \`computed_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_prs_org\`  (\`organization_id\`),
      UNIQUE INDEX \`idx_prs_replay\` (\`replay_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`workflow_congestion_metrics\` (
      \`id\`               VARCHAR(128) NOT NULL,
      \`organization_id\`  INT          NOT NULL,
      \`stage\`            VARCHAR(64)  NOT NULL,
      \`department\`       VARCHAR(128) NOT NULL,
      \`pending_count\`    INT          NOT NULL DEFAULT 0,
      \`avg_age_hours\`    DECIMAL(10,2) NOT NULL DEFAULT 0,
      \`congestion_level\` VARCHAR(16)  NOT NULL DEFAULT 'low',
      \`measured_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_wcm_org\`   (\`organization_id\`),
      INDEX \`idx_wcm_stage\` (\`stage\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`operational_health_snapshots\` (
      \`id\`               VARCHAR(128) NOT NULL,
      \`organization_id\`  INT          NOT NULL,
      \`overall_status\`   VARCHAR(16)  NOT NULL DEFAULT 'healthy',
      \`avg_score\`        INT          NOT NULL DEFAULT 100,
      \`workflow_health\`  INT          NOT NULL DEFAULT 100,
      \`review_health\`    INT          NOT NULL DEFAULT 100,
      \`approval_health\`  INT          NOT NULL DEFAULT 100,
      \`onboarding_health\` INT         NOT NULL DEFAULT 100,
      \`support_health\`   INT          NOT NULL DEFAULT 100,
      \`active_incidents\` INT          NOT NULL DEFAULT 0,
      \`active_risks\`     INT          NOT NULL DEFAULT 0,
      \`snapshot_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`createdAt\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ohs_org\`    (\`organization_id\`),
      INDEX \`idx_ohs_status\` (\`overall_status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS \`training_analytics\` (
      \`id\`              VARCHAR(128) NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`user_hash\`       VARCHAR(32)  NOT NULL,
      \`module_id\`       VARCHAR(128) NOT NULL,
      \`module_name\`     VARCHAR(256) NOT NULL,
      \`role\`            VARCHAR(64)  NOT NULL,
      \`started_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`completed_at\`    DATETIME(3)  NULL,
      \`duration_ms\`     INT          NOT NULL DEFAULT 0,
      \`score\`           INT          NULL,
      \`attempts\`        INT          NOT NULL DEFAULT 1,
      \`is_simulation\`   TINYINT(1)   NOT NULL DEFAULT 0,
      \`createdAt\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ta_org\`    (\`organization_id\`),
      INDEX \`idx_ta_module\` (\`module_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Sprint 3.6 ────────────────────────────────────────────────────────────

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`institutional_deployments\` (
      \`id\`                   VARCHAR(64)  NOT NULL,
      \`organization_id\`      INT          NOT NULL,
      \`municipio\`            VARCHAR(255) NOT NULL,
      \`phase\`                VARCHAR(50)  NOT NULL DEFAULT 'planning',
      \`status\`               VARCHAR(50)  NOT NULL DEFAULT 'scheduled',
      \`target_version\`       VARCHAR(50)  NOT NULL,
      \`current_version\`      VARCHAR(50)  NOT NULL,
      \`rollout_percentage\`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
      \`health_score\`         TINYINT UNSIGNED NOT NULL DEFAULT 100,
      \`validation_results\`   JSON         NULL,
      \`rollback_point\`       VARCHAR(64)  NULL,
      \`activated_at\`         DATETIME(3)  NULL,
      \`completed_at\`         DATETIME(3)  NULL,
      \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_id_org\`     (\`organization_id\`),
      INDEX \`idx_id_status\`  (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`deployment_governance\` (
      \`id\`                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`deployment_id\`          VARCHAR(64)  NOT NULL,
      \`organization_id\`        INT          NOT NULL,
      \`approved_by\`            INT          NOT NULL,
      \`approval_justification\` TEXT         NOT NULL,
      \`constraints\`            JSON         NULL,
      \`governance_checks\`      JSON         NULL,
      \`governance_at\`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_dg_org\`       (\`organization_id\`),
      INDEX \`idx_dg_dep\`       (\`deployment_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`deployment_events\` (
      \`id\`              VARCHAR(64)  NOT NULL,
      \`deployment_id\`   VARCHAR(64)  NOT NULL,
      \`organization_id\` INT          NOT NULL,
      \`phase\`           VARCHAR(50)  NOT NULL,
      \`event_type\`      VARCHAR(50)  NOT NULL,
      \`actor\`           VARCHAR(255) NOT NULL,
      \`notes\`           TEXT         NULL,
      \`occurred_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_de_org\` (\`organization_id\`),
      INDEX \`idx_de_dep\` (\`deployment_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`deployment_validation_snapshots\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`deployment_id\`    VARCHAR(64)   NOT NULL,
      \`passed_count\`     SMALLINT      NOT NULL DEFAULT 0,
      \`warning_count\`    SMALLINT      NOT NULL DEFAULT 0,
      \`error_count\`      SMALLINT      NOT NULL DEFAULT 0,
      \`critical_count\`   SMALLINT      NOT NULL DEFAULT 0,
      \`overall_passed\`   TINYINT(1)    NOT NULL DEFAULT 0,
      \`replay_key\`       VARCHAR(64)   NOT NULL,
      \`generated_at\`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`idx_dvs_replay\`  (\`replay_key\`),
      INDEX \`idx_dvs_org\`            (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`service_health_snapshots\` (
      \`id\`                VARCHAR(64)      NOT NULL,
      \`organization_id\`   INT              NOT NULL,
      \`overall_sla_score\` TINYINT UNSIGNED NOT NULL DEFAULT 100,
      \`breaching_metrics\` JSON             NULL,
      \`warning_metrics\`   JSON             NULL,
      \`snapshot_at\`       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_shs_org\`  (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`operational_stability_metrics\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`metric_type\`      VARCHAR(50)   NOT NULL,
      \`value\`            DOUBLE        NOT NULL,
      \`unit\`             VARCHAR(20)   NOT NULL DEFAULT 'count',
      \`threshold\`        DOUBLE        NOT NULL,
      \`is_anomalous\`     TINYINT(1)    NOT NULL DEFAULT 0,
      \`recorded_at\`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_osm_org\`  (\`organization_id\`),
      INDEX \`idx_osm_type\` (\`organization_id\`, \`metric_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`stability_snapshots\` (
      \`id\`                VARCHAR(64)   NOT NULL,
      \`organization_id\`   INT           NOT NULL,
      \`overall_score\`     TINYINT UNSIGNED NOT NULL DEFAULT 100,
      \`degradation_level\` VARCHAR(20)   NOT NULL DEFAULT 'none',
      \`trend\`             VARCHAR(20)   NOT NULL DEFAULT 'stable',
      \`active_anomalies\`  JSON          NULL,
      \`snapshot_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ss_org\`  (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`recovery_checkpoints\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`checkpoint_type\`  VARCHAR(50)   NOT NULL,
      \`snapshot_data\`    JSON          NOT NULL,
      \`integrity_hash\`   VARCHAR(64)   NOT NULL,
      \`is_valid\`         TINYINT(1)    NOT NULL DEFAULT 1,
      \`created_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rc_org\`  (\`organization_id\`),
      INDEX \`idx_rc_type\` (\`organization_id\`, \`checkpoint_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`recovery_plans\` (
      \`id\`                    VARCHAR(64)   NOT NULL,
      \`organization_id\`       INT           NOT NULL,
      \`checkpoint_id\`         VARCHAR(64)   NOT NULL,
      \`plan_type\`             VARCHAR(50)   NOT NULL,
      \`steps\`                 JSON          NOT NULL,
      \`estimated_duration_ms\` INT           NOT NULL DEFAULT 0,
      \`risk_level\`            VARCHAR(20)   NOT NULL DEFAULT 'medium',
      \`validated_at\`          DATETIME(3)   NULL,
      \`created_at\`            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rp_org\`  (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`recovery_logs\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`plan_id\`          VARCHAR(64)   NOT NULL,
      \`step\`             SMALLINT      NOT NULL,
      \`outcome\`          VARCHAR(20)   NOT NULL,
      \`notes\`            TEXT          NULL,
      \`executed_at\`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_rl_org\`  (\`organization_id\`),
      INDEX \`idx_rl_plan\` (\`plan_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`governance_policies\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`policy_type\`      VARCHAR(50)   NOT NULL,
      \`name\`             VARCHAR(255)  NOT NULL,
      \`description\`      TEXT          NULL,
      \`rules\`            JSON          NOT NULL,
      \`is_active\`        TINYINT(1)    NOT NULL DEFAULT 1,
      \`effective_from\`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`effective_to\`     DATETIME(3)   NULL,
      \`created_by\`       INT           NOT NULL,
      \`created_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_gp_org\`    (\`organization_id\`),
      INDEX \`idx_gp_active\` (\`organization_id\`, \`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`governance_events\` (
      \`id\`               VARCHAR(64)   NOT NULL,
      \`policy_id\`        VARCHAR(64)   NOT NULL,
      \`organization_id\`  INT           NOT NULL,
      \`action\`           VARCHAR(50)   NOT NULL,
      \`actor\`            INT           NOT NULL,
      \`context\`          JSON          NULL,
      \`outcome\`          VARCHAR(30)   NOT NULL,
      \`justification\`    TEXT          NULL,
      \`occurred_at\`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ge_org\`    (\`organization_id\`),
      INDEX \`idx_ge_policy\` (\`policy_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`support_escalations\` (
      \`id\`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`incident_id\`      VARCHAR(64)  NOT NULL,
      \`escalation_level\` TINYINT      NOT NULL DEFAULT 1,
      \`escalated_to\`     VARCHAR(255) NOT NULL,
      \`reason\`           TEXT         NOT NULL,
      \`status\`           VARCHAR(50)  NOT NULL DEFAULT 'open',
      \`escalated_at\`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`resolved_at\`      DATETIME(3)  NULL,
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_se_org\`      (\`organization_id\`),
      INDEX \`idx_se_incident\` (\`incident_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`incident_correlations\` (
      \`id\`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`incident_id\`      VARCHAR(64)  NOT NULL,
      \`correlation_id\`   VARCHAR(64)  NOT NULL,
      \`impact_scope\`     VARCHAR(30)  NOT NULL DEFAULT 'single_user',
      \`impact_score\`     SMALLINT     NOT NULL DEFAULT 0,
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ic_org\`         (\`organization_id\`),
      INDEX \`idx_ic_correlation\` (\`correlation_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`continuous_operation_metrics\` (
      \`id\`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`period_days\`      SMALLINT     NOT NULL DEFAULT 30,
      \`workflow_decay\`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
      \`adoption_decay\`   TINYINT UNSIGNED NOT NULL DEFAULT 0,
      \`fatigue\`          TINYINT(1)   NOT NULL DEFAULT 0,
      \`support_overload\` TINYINT(1)   NOT NULL DEFAULT 0,
      \`degraded_metrics\` JSON         NULL,
      \`severity\`         VARCHAR(20)  NOT NULL DEFAULT 'none',
      \`recorded_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_com_org\`  (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`degradation_records\` (
      \`id\`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`metric_name\`      VARCHAR(100) NOT NULL,
      \`drop_percent\`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
      \`degraded\`         TINYINT(1)   NOT NULL DEFAULT 0,
      \`detected_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_dr_org\`  (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`ai_orchestrations\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`session_id\`       VARCHAR(40)  NOT NULL,
      \`prompt_id\`        VARCHAR(20)  NULL,
      \`provider\`         VARCHAR(50)  NOT NULL DEFAULT 'mock',
      \`model\`            VARCHAR(100) NOT NULL DEFAULT 'mock-default',
      \`status\`           VARCHAR(30)  NOT NULL DEFAULT 'queued',
      \`attempt\`          SMALLINT     NOT NULL DEFAULT 1,
      \`max_attempts\`     SMALLINT     NOT NULL DEFAULT 3,
      \`lineage\`          JSON         NULL,
      \`inputs\`           JSON         NULL,
      \`outputs\`          JSON         NULL,
      \`error\`            TEXT         NULL,
      \`history\`          JSON         NULL,
      \`replay_key\`       VARCHAR(64)  NOT NULL,
      \`started_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`completed_at\`     DATETIME(3)  NULL,
      \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ao_org\`      (\`organization_id\`),
      INDEX \`idx_ao_session\`  (\`organization_id\`, \`session_id\`),
      INDEX \`idx_ao_status\`   (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`ai_prompt_versions\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`prompt_key\`       VARCHAR(100) NOT NULL,
      \`version\`          VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
      \`content\`          LONGTEXT     NOT NULL,
      \`variables\`        JSON         NULL,
      \`status\`           VARCHAR(30)  NOT NULL DEFAULT 'draft',
      \`approved_by\`      INT          NULL,
      \`rejected_by\`      INT          NULL,
      \`rollback_from\`    VARCHAR(20)  NULL,
      \`lineage\`          JSON         NULL,
      \`history\`          JSON         NULL,
      \`legal_basis\`      TEXT         NULL,
      \`checksum\`         VARCHAR(64)  NOT NULL,
      \`metadata\`         JSON         NULL,
      \`created_by\`       INT          NOT NULL,
      \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_apv_org\`    (\`organization_id\`),
      INDEX \`idx_apv_key\`    (\`organization_id\`, \`prompt_key\`),
      INDEX \`idx_apv_status\` (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`semantic_memories\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`memory_type\`      VARCHAR(30)  NOT NULL DEFAULT 'semantic',
      \`key\`              VARCHAR(200) NOT NULL,
      \`value\`            LONGTEXT     NOT NULL,
      \`source_ref\`       VARCHAR(255) NULL,
      \`context\`          JSON         NULL,
      \`relevance_score\`  DECIMAL(4,3) NOT NULL DEFAULT 0.500,
      \`last_accessed_at\` DATETIME(3)  NULL,
      \`access_count\`     INT UNSIGNED NOT NULL DEFAULT 0,
      \`ttl_ms\`           BIGINT       NULL,
      \`is_active\`        TINYINT(1)   NOT NULL DEFAULT 1,
      \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_sm_org\`    (\`organization_id\`),
      INDEX \`idx_sm_type\`   (\`organization_id\`, \`memory_type\`),
      INDEX \`idx_sm_active\` (\`organization_id\`, \`is_active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`embedding_snapshots\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`text_hash\`        VARCHAR(64)  NOT NULL,
      \`model\`            VARCHAR(100) NOT NULL DEFAULT 'mock-embed-v1',
      \`dimensions\`       SMALLINT     NOT NULL DEFAULT 1536,
      \`checksum\`         VARCHAR(64)  NOT NULL,
      \`vector_preview\`   JSON         NULL,
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_es_org\`      (\`organization_id\`),
      INDEX \`idx_es_hash\`     (\`text_hash\`),
      INDEX \`idx_es_checksum\` (\`checksum\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`vector_index_snapshots\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`index_name\`       VARCHAR(100) NOT NULL,
      \`dimensions\`       SMALLINT     NOT NULL DEFAULT 1536,
      \`entry_count\`      INT UNSIGNED NOT NULL DEFAULT 0,
      \`metadata\`         JSON         NULL,
      \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_vis_org\`  (\`organization_id\`),
      INDEX \`idx_vis_name\` (\`organization_id\`, \`index_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`grounding_evidence\` (
      \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`  INT          NOT NULL,
      \`source_ref\`       VARCHAR(255) NOT NULL,
      \`content\`          LONGTEXT     NOT NULL,
      \`relevance_score\`  DECIMAL(4,3) NOT NULL DEFAULT 0.500,
      \`evidence_type\`    VARCHAR(30)  NOT NULL DEFAULT 'document',
      \`legal_basis\`      TEXT         NULL,
      \`citation_key\`     VARCHAR(100) NOT NULL,
      \`verified\`         TINYINT(1)   NOT NULL DEFAULT 0,
      \`verified_at\`      DATETIME(3)  NULL,
      \`metadata\`         JSON         NULL,
      \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ge_org\`      (\`organization_id\`),
      INDEX \`idx_ge_type\`     (\`organization_id\`, \`evidence_type\`),
      INDEX \`idx_ge_citation\` (\`citation_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`ai_execution_audits\` (
      \`id\`                  VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`     INT          NOT NULL,
      \`session_id\`          VARCHAR(40)  NOT NULL,
      \`operation\`           VARCHAR(30)  NOT NULL,
      \`actor_id\`            INT          NULL,
      \`provider\`            VARCHAR(50)  NULL,
      \`model_id\`            VARCHAR(100) NULL,
      \`prompt_id\`           VARCHAR(20)  NULL,
      \`input_hash\`          VARCHAR(64)  NOT NULL,
      \`output_hash\`         VARCHAR(64)  NULL,
      \`duration_ms\`         INT          NULL,
      \`token_count\`         INT          NULL,
      \`success\`             TINYINT(1)   NOT NULL DEFAULT 1,
      \`error\`               TEXT         NULL,
      \`replay_key\`          VARCHAR(64)  NOT NULL,
      \`forensic_signature\`  VARCHAR(64)  NOT NULL,
      \`immutable\`           TINYINT(1)   NOT NULL DEFAULT 1,
      \`recorded_at\`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_aea_org\`       (\`organization_id\`),
      INDEX \`idx_aea_session\`   (\`organization_id\`, \`session_id\`),
      INDEX \`idx_aea_operation\` (\`organization_id\`, \`operation\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`ai_token_estimations\` (
      \`id\`                VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`   INT          NOT NULL,
      \`session_id\`        VARCHAR(40)  NOT NULL,
      \`model\`             VARCHAR(100) NOT NULL DEFAULT 'mock-default',
      \`max_tokens\`        INT          NOT NULL DEFAULT 4096,
      \`used_tokens\`       INT          NOT NULL DEFAULT 0,
      \`reserved_tokens\`   INT          NOT NULL DEFAULT 0,
      \`cost_estimate_usd\` DECIMAL(10,6) NOT NULL DEFAULT 0.000000,
      \`warnings\`          JSON         NULL,
      \`hard_limit\`        TINYINT(1)   NOT NULL DEFAULT 0,
      \`updated_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_ate_org\`     (\`organization_id\`),
      INDEX \`idx_ate_session\` (\`organization_id\`, \`session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`ai_workflow_states\` (
      \`id\`                      VARCHAR(20)  NOT NULL PRIMARY KEY,
      \`organization_id\`         INT          NOT NULL,
      \`workflow_key\`            VARCHAR(100) NOT NULL,
      \`current_step\`            VARCHAR(30)  NOT NULL DEFAULT 'ai_generation',
      \`status\`                  VARCHAR(30)  NOT NULL DEFAULT 'pending',
      \`steps\`                   JSON         NULL,
      \`overrides\`               JSON         NULL,
      \`approvals\`               JSON         NULL,
      \`actor\`                   INT          NOT NULL,
      \`requires_human_approval\` TINYINT(1)   NOT NULL DEFAULT 0,
      \`auto_approval_threshold\` DECIMAL(4,3) NULL,
      \`explanation\`             TEXT         NULL,
      \`lineage\`                 JSON         NULL,
      \`history\`                 JSON         NULL,
      \`updated_at\`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`created_at\`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`idx_aws_org\`    (\`organization_id\`),
      INDEX \`idx_aws_key\`    (\`organization_id\`, \`workflow_key\`),
      INDEX \`idx_aws_status\` (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`semantic_chunks\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`document_id\`      VARCHAR(100) NOT NULL,
        \`document_type\`    VARCHAR(50)  NOT NULL,
        \`content\`          TEXT         NULL,
        \`token_count\`      INT          NOT NULL DEFAULT 0,
        \`chunk_index\`      INT          NOT NULL DEFAULT 0,
        \`total_chunks\`     INT          NOT NULL DEFAULT 0,
        \`strategy\`         VARCHAR(50)  NOT NULL,
        \`section_title\`    VARCHAR(255) NULL,
        \`legal_ref\`        VARCHAR(255) NULL,
        \`overlap_with_prev\` INT         NOT NULL DEFAULT 0,
        \`lineage\`          JSON         NULL,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`metadata\`         JSON         NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_sc_org\`      (\`organization_id\`),
        INDEX \`idx_sc_doc\`      (\`organization_id\`, \`document_id\`),
        INDEX \`idx_sc_strategy\` (\`organization_id\`, \`strategy\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`retrieval_queries\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`raw_query\`        TEXT         NULL,
        \`expanded_terms\`   JSON         NULL,
        \`synonym_expansion\` JSON        NULL,
        \`corrected_query\`  VARCHAR(500) NULL,
        \`filters\`          JSON         NULL,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_rq_org\`      (\`organization_id\`),
        INDEX \`idx_rq_replay\`   (\`replay_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`retrieval_results\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`query_id\`         VARCHAR(20)  NOT NULL,
        \`chunk_id\`         VARCHAR(20)  NOT NULL,
        \`lexical_score\`    DECIMAL(6,5) NOT NULL DEFAULT 0,
        \`semantic_score\`   DECIMAL(6,5) NOT NULL DEFAULT 0,
        \`contextual_score\` DECIMAL(6,5) NOT NULL DEFAULT 0,
        \`hybrid_score\`     DECIMAL(6,5) NOT NULL DEFAULT 0,
        \`rank_position\`    INT          NOT NULL DEFAULT 0,
        \`retrieval_strategy\` VARCHAR(50) NOT NULL,
        \`score_breakdown\`  JSON         NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_rr_org\`      (\`organization_id\`),
        INDEX \`idx_rr_query\`    (\`organization_id\`, \`query_id\`),
        INDEX \`idx_rr_chunk\`    (\`organization_id\`, \`chunk_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`semantic_relationships\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`source_node_id\`   VARCHAR(100) NOT NULL,
        \`source_type\`      VARCHAR(50)  NOT NULL,
        \`target_node_id\`   VARCHAR(100) NOT NULL,
        \`target_type\`      VARCHAR(50)  NOT NULL,
        \`edge_type\`        VARCHAR(50)  NOT NULL,
        \`weight\`           DECIMAL(6,5) NOT NULL DEFAULT 1,
        \`propagated_score\` DECIMAL(6,5) NULL,
        \`hop_distance\`     INT          NOT NULL DEFAULT 0,
        \`metadata\`         JSON         NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_sr_org\`    (\`organization_id\`),
        INDEX \`idx_sr_source\` (\`organization_id\`, \`source_node_id\`),
        INDEX \`idx_sr_target\` (\`organization_id\`, \`target_node_id\`),
        INDEX \`idx_sr_type\`   (\`organization_id\`, \`edge_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`institutional_memories\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`memory_type\`      VARCHAR(50)  NOT NULL,
        \`content\`          TEXT         NULL,
        \`source_id\`        VARCHAR(100) NULL,
        \`source_type\`      VARCHAR(50)  NULL,
        \`confidence\`       DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`access_count\`     INT          NOT NULL DEFAULT 0,
        \`tags\`             JSON         NULL,
        \`ttl_ms\`           BIGINT       NULL,
        \`lineage\`          JSON         NULL,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_im_org\`     (\`organization_id\`),
        INDEX \`idx_im_type\`    (\`organization_id\`, \`memory_type\`),
        INDEX \`idx_im_source\`  (\`organization_id\`, \`source_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`evidence_chains\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`chain_type\`       VARCHAR(50)  NOT NULL,
        \`head_evidence_id\` VARCHAR(100) NOT NULL,
        \`links\`            JSON         NULL,
        \`total_links\`      INT          NOT NULL DEFAULT 0,
        \`confidence\`       DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`provenance\`       JSON         NULL,
        \`is_superseded\`    TINYINT(1)   NOT NULL DEFAULT 0,
        \`superseded_by\`    VARCHAR(20)  NULL,
        \`lineage\`          JSON         NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_ec_org\`       (\`organization_id\`),
        INDEX \`idx_ec_type\`      (\`organization_id\`, \`chain_type\`),
        INDEX \`idx_ec_head\`      (\`organization_id\`, \`head_evidence_id\`),
        INDEX \`idx_ec_superseded\` (\`organization_id\`, \`is_superseded\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`retrieval_explanations\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`query_id\`         VARCHAR(20)  NOT NULL,
        \`correlation_id\`   VARCHAR(20)  NOT NULL,
        \`explanation_tree\` JSON         NULL,
        \`ranking_lineage\`  JSON         NULL,
        \`trace_steps\`      JSON         NULL,
        \`human_summary\`    TEXT         NULL,
        \`confidence\`       DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_re_org\`         (\`organization_id\`),
        INDEX \`idx_re_query\`       (\`organization_id\`, \`query_id\`),
        INDEX \`idx_re_correlation\` (\`organization_id\`, \`correlation_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`semantic_indexes\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`index_name\`       VARCHAR(100) NOT NULL,
        \`entity_type\`      VARCHAR(50)  NOT NULL,
        \`entity_id\`        VARCHAR(100) NOT NULL,
        \`tokens\`           JSON         NULL,
        \`token_count\`      INT          NOT NULL DEFAULT 0,
        \`index_hash\`       VARCHAR(64)  NOT NULL,
        \`content_preview\`  VARCHAR(500) NULL,
        \`metadata\`         JSON         NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_si_org\`         (\`organization_id\`),
        INDEX \`idx_si_name\`        (\`organization_id\`, \`index_name\`),
        INDEX \`idx_si_entity\`      (\`organization_id\`, \`entity_type\`, \`entity_id\`),
        INDEX \`idx_si_hash\`        (\`index_hash\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`retrieval_observability\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`correlation_id\`   VARCHAR(20)  NOT NULL,
        \`operation\`        VARCHAR(100) NOT NULL,
        \`duration_ms\`      INT          NOT NULL DEFAULT 0,
        \`result_count\`     INT          NOT NULL DEFAULT 0,
        \`avg_score\`        DECIMAL(6,5) NULL,
        \`p95_latency_ms\`   INT          NULL,
        \`stage_breakdown\`  JSON         NULL,
        \`tags\`             JSON         NULL,
        \`alert_fired\`      TINYINT(1)   NOT NULL DEFAULT 0,
        \`alert_type\`       VARCHAR(50)  NULL,
        \`recorded_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_ro_org\`         (\`organization_id\`),
        INDEX \`idx_ro_correlation\` (\`organization_id\`, \`correlation_id\`),
        INDEX \`idx_ro_operation\`   (\`organization_id\`, \`operation\`),
        INDEX \`idx_ro_alert\`       (\`organization_id\`, \`alert_fired\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`memory_retention_snapshots\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`policy_id\`        VARCHAR(20)  NOT NULL,
        \`snapshot_type\`    VARCHAR(50)  NOT NULL,
        \`total_memories\`   INT          NOT NULL DEFAULT 0,
        \`active_count\`     INT          NOT NULL DEFAULT 0,
        \`expiring_soon_count\` INT       NOT NULL DEFAULT 0,
        \`expired_count\`    INT          NOT NULL DEFAULT 0,
        \`archived_count\`   INT          NOT NULL DEFAULT 0,
        \`avg_confidence\`   DECIMAL(4,3) NULL,
        \`metrics\`          JSON         NULL,
        \`lineage\`          JSON         NULL,
        \`snapshot_at\`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_mrs_org\`    (\`organization_id\`),
        INDEX \`idx_mrs_policy\` (\`organization_id\`, \`policy_id\`),
        INDEX \`idx_mrs_type\`   (\`organization_id\`, \`snapshot_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`context_assemblies\` (
        \`id\`                  VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`     INT          NOT NULL,
        \`session_id\`          VARCHAR(100) NOT NULL,
        \`total_tokens_used\`   INT          NOT NULL DEFAULT 0,
        \`fragment_count\`      INT          NOT NULL DEFAULT 0,
        \`compression_applied\` TINYINT(1)   NOT NULL DEFAULT 0,
        \`status\`              VARCHAR(50)  NOT NULL DEFAULT 'open',
        \`assembly_reason_key\` VARCHAR(64)  NULL,
        \`lineage\`             JSON         NULL,
        \`replay_key\`          VARCHAR(64)  NOT NULL,
        \`assembled_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`created_at\`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_ca_org\`     (\`organization_id\`),
        INDEX \`idx_ca_session\` (\`organization_id\`, \`session_id\`),
        INDEX \`idx_ca_replay\`  (\`replay_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`context_fragments\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`assembly_id\`      VARCHAR(20)  NOT NULL,
        \`source\`           VARCHAR(50)  NOT NULL,
        \`content\`          TEXT         NULL,
        \`token_estimate\`   INT          NOT NULL DEFAULT 0,
        \`priority\`         VARCHAR(20)  NOT NULL DEFAULT 'medium',
        \`relevance_score\`  DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`confidence\`       DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`is_stale\`         TINYINT(1)   NOT NULL DEFAULT 0,
        \`staleness\`        DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`legal_basis\`      TEXT         NULL,
        \`temporal_context\` DATETIME(3)  NULL,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_cf_org\`      (\`organization_id\`),
        INDEX \`idx_cf_assembly\` (\`organization_id\`, \`assembly_id\`),
        INDEX \`idx_cf_source\`   (\`organization_id\`, \`source\`),
        INDEX \`idx_cf_priority\` (\`organization_id\`, \`priority\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`prompt_chains\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`name\`             VARCHAR(255) NOT NULL,
        \`stages\`           JSON         NULL,
        \`transitions\`      JSON         NULL,
        \`max_total_tokens\` INT          NOT NULL DEFAULT 4096,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_pc_org\`    (\`organization_id\`),
        INDEX \`idx_pc_replay\` (\`replay_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`prompt_stages\` (
        \`id\`                VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`   INT          NOT NULL,
        \`chain_id\`          VARCHAR(20)  NOT NULL,
        \`name\`              VARCHAR(255) NOT NULL,
        \`stage_type\`        VARCHAR(50)  NOT NULL,
        \`template_id\`       VARCHAR(20)  NOT NULL,
        \`input_variables\`   JSON         NULL,
        \`output_schema\`     JSON         NULL,
        \`max_tokens\`        INT          NOT NULL DEFAULT 1024,
        \`timeout_ms\`        INT          NOT NULL DEFAULT 30000,
        \`retry_count\`       INT          NOT NULL DEFAULT 3,
        \`fallback_strategy\` VARCHAR(50)  NOT NULL DEFAULT 'retry',
        \`depends_on\`        JSON         NULL,
        \`guardrails\`        JSON         NULL,
        \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_ps_org\`   (\`organization_id\`),
        INDEX \`idx_ps_chain\` (\`organization_id\`, \`chain_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`prompt_templates\` (
        \`id\`               VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`  INT          NOT NULL,
        \`template_key\`     VARCHAR(100) NOT NULL,
        \`name\`             VARCHAR(255) NOT NULL,
        \`content\`          TEXT         NULL,
        \`variables\`        JSON         NULL,
        \`version\`          VARCHAR(20)  NOT NULL DEFAULT '1.0.0',
        \`legal_basis\`      TEXT         NULL,
        \`role\`             VARCHAR(50)  NULL,
        \`is_approved\`      TINYINT(1)   NOT NULL DEFAULT 0,
        \`approved_by\`      INT          NULL,
        \`approved_at\`      DATETIME(3)  NULL,
        \`lineage\`          JSON         NULL,
        \`replay_key\`       VARCHAR(64)  NOT NULL,
        \`created_by\`       INT          NOT NULL,
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_pt_org\`     (\`organization_id\`),
        INDEX \`idx_pt_key\`     (\`organization_id\`, \`template_key\`),
        INDEX \`idx_pt_version\` (\`organization_id\`, \`template_key\`, \`version\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`reasoning_traces\` (
        \`id\`                   VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`      INT          NOT NULL,
        \`session_id\`           VARCHAR(100) NOT NULL,
        \`stages\`               JSON         NULL,
        \`final_conclusion\`     TEXT         NULL,
        \`overall_confidence\`   DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`contradictions_found\` INT          NOT NULL DEFAULT 0,
        \`ambiguities_found\`    INT          NOT NULL DEFAULT 0,
        \`citation_count\`       INT          NOT NULL DEFAULT 0,
        \`replay_key\`           VARCHAR(64)  NOT NULL,
        \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_rt_org\`     (\`organization_id\`),
        INDEX \`idx_rt_session\` (\`organization_id\`, \`session_id\`),
        INDEX \`idx_rt_replay\`  (\`replay_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`grounding_evidences\` (
        \`id\`                   VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`      INT          NOT NULL,
        \`query_id\`             VARCHAR(100) NOT NULL,
        \`source_type\`          VARCHAR(50)  NOT NULL,
        \`content\`              TEXT         NULL,
        \`citation\`             VARCHAR(500) NOT NULL,
        \`authority\`            DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`relevance_score\`      DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`legal_basis\`          TEXT         NULL,
        \`provenance\`           JSON         NULL,
        \`is_verified\`          TINYINT(1)   NOT NULL DEFAULT 0,
        \`hallucination_risk\`   DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`grounding_confidence\` DECIMAL(4,3) NOT NULL DEFAULT 0,
        \`replay_key\`           VARCHAR(64)  NOT NULL,
        \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_ge_org\`   (\`organization_id\`),
        INDEX \`idx_ge_query\` (\`organization_id\`, \`query_id\`),
        INDEX \`idx_ge_type\`  (\`organization_id\`, \`source_type\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`context_observability\` (
        \`id\`               VARCHAR(20)   NOT NULL PRIMARY KEY,
        \`organization_id\`  INT           NOT NULL,
        \`session_id\`       VARCHAR(100)  NOT NULL,
        \`metric_name\`      VARCHAR(100)  NOT NULL,
        \`value\`            DECIMAL(10,4) NOT NULL DEFAULT 0,
        \`unit\`             VARCHAR(20)   NOT NULL,
        \`tags\`             JSON          NULL,
        \`recorded_at\`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_co_org\`     (\`organization_id\`),
        INDEX \`idx_co_session\` (\`organization_id\`, \`session_id\`),
        INDEX \`idx_co_metric\`  (\`organization_id\`, \`metric_name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`orchestration_executions\` (
        \`id\`                VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`   INT          NOT NULL,
        \`session_id\`        VARCHAR(100) NOT NULL,
        \`chain_id\`          VARCHAR(20)  NOT NULL,
        \`status\`            VARCHAR(50)  NOT NULL DEFAULT 'pending',
        \`stage_executions\`  JSON         NULL,
        \`final_output\`      TEXT         NULL,
        \`total_tokens_used\` INT          NOT NULL DEFAULT 0,
        \`total_duration_ms\` INT          NOT NULL DEFAULT 0,
        \`correlation_id\`    VARCHAR(20)  NOT NULL,
        \`replay_key\`        VARCHAR(64)  NOT NULL,
        \`executed_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_oe_org\`         (\`organization_id\`),
        INDEX \`idx_oe_session\`     (\`organization_id\`, \`session_id\`),
        INDEX \`idx_oe_chain\`       (\`organization_id\`, \`chain_id\`),
        INDEX \`idx_oe_correlation\` (\`organization_id\`, \`correlation_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`semantic_compressions\` (
        \`id\`                    VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`       INT          NOT NULL,
        \`session_id\`            VARCHAR(100) NOT NULL,
        \`original_tokens\`       INT          NOT NULL DEFAULT 0,
        \`compressed_tokens\`     INT          NOT NULL DEFAULT 0,
        \`compression_ratio\`     DECIMAL(4,3) NOT NULL DEFAULT 1,
        \`deduplicated_count\`    INT          NOT NULL DEFAULT 0,
        \`overlap_removed_count\` INT          NOT NULL DEFAULT 0,
        \`replay_key\`            VARCHAR(64)  NOT NULL,
        \`created_at\`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_sc2_org\`     (\`organization_id\`),
        INDEX \`idx_sc2_session\` (\`organization_id\`, \`session_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS \`context_policies\` (
        \`id\`                VARCHAR(20)  NOT NULL PRIMARY KEY,
        \`organization_id\`   INT          NOT NULL,
        \`policy_type\`       VARCHAR(50)  NOT NULL,
        \`name\`              VARCHAR(255) NOT NULL,
        \`description\`       TEXT         NULL,
        \`applies_to\`        JSON         NULL,
        \`sensitivity_level\` VARCHAR(50)  NOT NULL DEFAULT 'internal',
        \`masking_strategy\`  VARCHAR(50)  NULL,
        \`requires_evidence\` TINYINT(1)   NOT NULL DEFAULT 0,
        \`retention_ms\`      BIGINT       NULL,
        \`legal_basis\`       TEXT         NULL,
        \`is_active\`         TINYINT(1)   NOT NULL DEFAULT 1,
        \`priority\`          INT          NOT NULL DEFAULT 0,
        \`created_by\`        INT          NOT NULL,
        \`created_at\`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX \`idx_cp_org\`    (\`organization_id\`),
        INDEX \`idx_cp_type\`   (\`organization_id\`, \`policy_type\`),
        INDEX \`idx_cp_active\` (\`organization_id\`, \`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ─── Sprint 4.3: Legal AI Tables ─────────────────────────────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_reasoning_traces\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`overall_compliance_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`overall_risk_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`replay_key\` VARCHAR(64) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_lrt_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_inferences\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`trace_id\` VARCHAR(20) NOT NULL,
      \`conclusion\` TEXT NULL,
      \`inference_type\` ENUM('deductive','inductive','analogical','abductive') NOT NULL DEFAULT 'deductive',
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.7500,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`justification\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_li_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`compliance_checks\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`trace_id\` VARCHAR(20) NOT NULL,
      \`rule_id\` VARCHAR(100) NOT NULL,
      \`rule_name\` VARCHAR(255) NOT NULL,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`status\` ENUM('compliant','non_compliant','uncertain','not_applicable') NOT NULL DEFAULT 'uncertain',
      \`findings\` TEXT NULL,
      \`remediation\` TEXT NULL,
      \`check_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_cc_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_risks\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`trace_id\` VARCHAR(20) NOT NULL,
      \`risk_type\` VARCHAR(255) NOT NULL,
      \`description\` TEXT NULL,
      \`level\` ENUM('critical','high','medium','low','negligible') NOT NULL DEFAULT 'medium',
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`probability\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`impact\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`risk_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_lr_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`draft_templates\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`name\` VARCHAR(255) NOT NULL,
      \`document_type\` VARCHAR(100) NOT NULL,
      \`version\` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      \`legal_framework\` VARCHAR(255) NOT NULL DEFAULT 'Lei 14133/2021',
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_dt_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`draft_sections\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`template_id\` VARCHAR(20) NOT NULL,
      \`title\` VARCHAR(255) NOT NULL,
      \`order_index\` INT NOT NULL DEFAULT 0,
      \`is_optional\` TINYINT(1) NOT NULL DEFAULT 0,
      \`legal_basis\` VARCHAR(500) NULL,
      \`condition_expression\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_ds_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`draft_generations\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`template_id\` VARCHAR(20) NOT NULL,
      \`resolved_content\` MEDIUMTEXT NULL,
      \`generation_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`replay_key\` VARCHAR(64) NOT NULL,
      \`generated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_dg_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`draft_recommendations\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`trace_id\` VARCHAR(20) NOT NULL,
      \`recommendation_type\` ENUM('mandatory','advisory','optional','warning') NOT NULL DEFAULT 'advisory',
      \`content\` TEXT NULL,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`priority\` INT NOT NULL DEFAULT 1,
      \`rationale\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_drc_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`clause_recommendations\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`clause_id\` VARCHAR(100) NOT NULL,
      \`recommendation_type\` ENUM('add','remove','modify','reorder') NOT NULL DEFAULT 'modify',
      \`content\` TEXT NULL,
      \`rationale\` TEXT NULL,
      \`priority\` INT NOT NULL DEFAULT 1,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_clrec_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`clause_conflicts\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`clause_id_a\` VARCHAR(100) NOT NULL,
      \`clause_id_b\` VARCHAR(100) NOT NULL,
      \`compatibility_score\` DECIMAL(5,4) NOT NULL DEFAULT 1,
      \`conflict_type\` ENUM('direct','indirect','conditional','none') NOT NULL DEFAULT 'none',
      \`explanation\` TEXT NULL,
      \`resolution\` TEXT NULL,
      \`checked_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_clconf_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`jurisprudence_references\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`case_number\` VARCHAR(255) NOT NULL,
      \`court\` VARCHAR(255) NOT NULL,
      \`court_level\` ENUM('supreme','superior','regional','federal','state','administrative') NOT NULL DEFAULT 'superior',
      \`judgment_date\` DATE NULL,
      \`summary\` TEXT NULL,
      \`precedent_strength\` ENUM('binding','persuasive','informative','overruled') NOT NULL DEFAULT 'informative',
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_jref_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`jurisprudence_correlations\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`source_id\` VARCHAR(255) NOT NULL,
      \`reference_id\` VARCHAR(20) NOT NULL,
      \`citation_type\` ENUM('direct','analogical','distinguishing','overruling') NOT NULL DEFAULT 'analogical',
      \`relevance_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`correlation_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_jcorr_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`drafting_observability\` (
      \`id\` VARCHAR(20) NOT NULL,
      \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(255) NOT NULL,
      \`correlation_id\` VARCHAR(20) NOT NULL,
      \`draft_id\` VARCHAR(20) NOT NULL,
      \`document_type\` VARCHAR(100) NOT NULL,
      \`total_ms\` INT NOT NULL DEFAULT 0,
      \`completeness_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`risk_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`compliance_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`variable_count\` INT NOT NULL DEFAULT 0,
      \`missing_variables\` INT NOT NULL DEFAULT 0,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      INDEX \`idx_dobs_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 4.4: Agent Execution Engine Tables ───────────────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`agent_executions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`session_id\` VARCHAR(255) NOT NULL,
      \`agent_type\` VARCHAR(255) NOT NULL, \`status\` ENUM('pending','running','paused','awaiting_approval','completed','failed','rolled_back','cancelled') NOT NULL DEFAULT 'pending',
      \`current_stage\` VARCHAR(255) NULL, \`replay_key\` VARCHAR(64) NOT NULL,
      \`correlation_id\` VARCHAR(20) NOT NULL, \`request_id\` VARCHAR(20) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`completed_at\` DATETIME(3) NULL, \`rollback_at\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`), INDEX \`idx_ae_org\` (\`organization_id\`), INDEX \`idx_ae_sess\` (\`organization_id\`, \`session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_stages\` (
      \`id\` VARCHAR(20) NOT NULL, \`execution_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`stage_name\` VARCHAR(255) NOT NULL, \`stage_order\` INT NOT NULL DEFAULT 0,
      \`status\` ENUM('pending','running','completed','failed','skipped') NOT NULL DEFAULT 'pending',
      \`input\` JSON NULL, \`output\` JSON NULL, \`duration_ms\` INT NULL, \`error_message\` TEXT NULL,
      \`started_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`completed_at\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`), INDEX \`idx_es_org\` (\`organization_id\`), INDEX \`idx_es_exec\` (\`execution_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_checkpoints\` (
      \`id\` VARCHAR(20) NOT NULL, \`execution_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`checkpoint_name\` VARCHAR(255) NOT NULL, \`snapshot_data\` JSON NULL,
      \`is_rollback_point\` TINYINT(1) NOT NULL DEFAULT 0, \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ec_org\` (\`organization_id\`), INDEX \`idx_ec_exec\` (\`execution_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_replays\` (
      \`id\` VARCHAR(20) NOT NULL, \`original_execution_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`reason\` TEXT NULL, \`replay_key\` VARCHAR(64) NOT NULL,
      \`status\` ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_er_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_rollbacks\` (
      \`id\` VARCHAR(20) NOT NULL, \`execution_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`reason\` TEXT NULL, \`initiated_by\` VARCHAR(255) NOT NULL, \`checkpoint_id\` VARCHAR(20) NULL,
      \`status\` ENUM('pending','executing','completed','failed') NOT NULL DEFAULT 'pending',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_erb_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_plans\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`session_id\` VARCHAR(255) NOT NULL,
      \`plan_name\` VARCHAR(255) NOT NULL, \`goal_description\` TEXT NULL,
      \`estimated_duration_ms\` INT NOT NULL DEFAULT 0, \`replay_key\` VARCHAR(64) NOT NULL,
      \`plan_version\` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      \`status\` ENUM('draft','ready','executing','completed','failed') NOT NULL DEFAULT 'draft',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ep_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_tasks\` (
      \`id\` VARCHAR(20) NOT NULL, \`plan_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`task_name\` VARCHAR(255) NOT NULL, \`task_type\` VARCHAR(255) NOT NULL, \`description\` TEXT NULL,
      \`priority\` ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
      \`status\` ENUM('pending','ready','running','completed','failed','skipped','blocked') NOT NULL DEFAULT 'pending',
      \`parallelizable\` TINYINT(1) NOT NULL DEFAULT 0, \`estimated_ms\` INT NOT NULL DEFAULT 1000,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`completed_at\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`), INDEX \`idx_et_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`assistant_profiles\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`role\` VARCHAR(100) NOT NULL,
      \`name\` VARCHAR(255) NOT NULL, \`description\` TEXT NULL, \`version\` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1, \`requires_human_review\` TINYINT(1) NOT NULL DEFAULT 1,
      \`escalation_threshold\` DECIMAL(5,4) NOT NULL DEFAULT 0.7000,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ap_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`assistant_capabilities\` (
      \`id\` VARCHAR(20) NOT NULL, \`profile_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`capability_type\` VARCHAR(100) NOT NULL, \`description\` TEXT NULL,
      \`confidence_threshold\` DECIMAL(5,4) NOT NULL DEFAULT 0.7000, \`max_input_length\` INT NOT NULL DEFAULT 10000,
      \`is_enabled\` TINYINT(1) NOT NULL DEFAULT 1, \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ac_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`approval_workflows\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`execution_id\` VARCHAR(20) NULL,
      \`plan_id\` VARCHAR(20) NULL, \`approval_type\` VARCHAR(255) NOT NULL,
      \`status\` ENUM('pending','approved','rejected','escalated','delegated','expired','overridden') NOT NULL DEFAULT 'pending',
      \`priority\` ENUM('urgent','high','normal','low') NOT NULL DEFAULT 'normal',
      \`deadline\` DATETIME(3) NULL, \`escalate_to\` VARCHAR(255) NULL, \`delegated_to\` VARCHAR(255) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`resolved_at\` DATETIME(3) NULL,
      PRIMARY KEY (\`id\`), INDEX \`idx_aw_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`approval_decisions\` (
      \`id\` VARCHAR(20) NOT NULL, \`workflow_id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`approver\` VARCHAR(255) NOT NULL,
      \`decision\` ENUM('approve','reject','delegate','escalate') NOT NULL,
      \`justification\` TEXT NULL, \`decided_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ad_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`action_safety_logs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`action_type\` VARCHAR(255) NOT NULL,
      \`execution_id\` VARCHAR(20) NULL,
      \`safety_level\` ENUM('safe','low_risk','medium_risk','high_risk','critical','blocked') NOT NULL DEFAULT 'safe',
      \`passed\` TINYINT(1) NOT NULL DEFAULT 1, \`confidence_score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`recommendation\` ENUM('proceed','pause','block','escalate') NOT NULL DEFAULT 'proceed',
      \`checked_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_asl_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`execution_observability\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`correlation_id\` VARCHAR(20) NOT NULL,
      \`execution_id\` VARCHAR(20) NOT NULL, \`agent_type\` VARCHAR(255) NOT NULL,
      \`total_stages\` INT NOT NULL DEFAULT 0, \`completed_stages\` INT NOT NULL DEFAULT 0,
      \`failed_stages\` INT NOT NULL DEFAULT 0, \`approval_required\` TINYINT(1) NOT NULL DEFAULT 0,
      \`safety_blocked\` TINYINT(1) NOT NULL DEFAULT 0, \`total_ms\` INT NOT NULL DEFAULT 0,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_eo_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`simulation_runs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`session_id\` VARCHAR(255) NOT NULL,
      \`simulation_type\` ENUM('dry_run','full_preview','rollback_preview','impact_estimation') NOT NULL DEFAULT 'dry_run',
      \`overall_risk\` ENUM('safe','low_risk','medium_risk','high_risk','critical','blocked') NOT NULL DEFAULT 'safe',
      \`task_count\` INT NOT NULL DEFAULT 0, \`impact_summary\` TEXT NULL, \`rollback_summary\` TEXT NULL,
      \`replay_key\` VARCHAR(64) NOT NULL, \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_sr_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`ai_providers\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`provider_type\` ENUM('openai','claude','gemini','mock') NOT NULL,
      \`provider_name\` VARCHAR(255) NOT NULL, \`enabled\` TINYINT(1) NOT NULL DEFAULT 1,
      \`priority\` INT NOT NULL DEFAULT 5, \`supported_capabilities\` TEXT NULL,
      \`health_status\` ENUM('healthy','degraded','unavailable','unknown') NOT NULL DEFAULT 'unknown',
      \`latency_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.5, \`reliability_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.8,
      \`cost_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.5, \`rate_limit_config\` TEXT NULL,
      \`retry_policy\` TEXT NULL,
      \`circuit_breaker_state\` ENUM('closed','open','half_open') NOT NULL DEFAULT 'closed',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ap_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_executions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workflow_id\` VARCHAR(255) NOT NULL, \`provider_id\` VARCHAR(20) NOT NULL,
      \`model\` VARCHAR(255) NOT NULL,
      \`execution_type\` ENUM('inference','embedding','classification','completion') NOT NULL DEFAULT 'inference',
      \`prompt_hash\` VARCHAR(64) NOT NULL, \`prompt_version\` VARCHAR(50) NOT NULL DEFAULT '1.0',
      \`request_payload\` TEXT NULL, \`response_payload\` TEXT NULL,
      \`prompt_tokens\` INT NOT NULL DEFAULT 0, \`completion_tokens\` INT NOT NULL DEFAULT 0,
      \`total_tokens\` INT NOT NULL DEFAULT 0, \`latency_ms\` INT NOT NULL DEFAULT 0,
      \`retry_count\` INT NOT NULL DEFAULT 0, \`fallback_triggered\` TINYINT(1) NOT NULL DEFAULT 0,
      \`execution_status\` ENUM('pending','running','completed','failed','fallback_triggered','replay') NOT NULL DEFAULT 'pending',
      \`correlation_id\` VARCHAR(64) NOT NULL, \`reasoning_trace\` TEXT NULL,
      \`explainability_data\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pe_org\` (\`organization_id\`), INDEX \`idx_pe_corr\` (\`correlation_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_policies\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`policy_name\` VARCHAR(255) NOT NULL, \`allowed_providers\` TEXT NULL,
      \`blocked_models\` TEXT NULL, \`max_tokens_per_execution\` INT NOT NULL DEFAULT 100000,
      \`max_cost_per_execution\` DECIMAL(10,4) NOT NULL DEFAULT 10.0,
      \`daily_cost_limit\` DECIMAL(10,4) NOT NULL DEFAULT 100.0,
      \`approval_threshold\` DECIMAL(10,4) NOT NULL DEFAULT 5.0,
      \`requires_human_approval\` TINYINT(1) NOT NULL DEFAULT 0,
      \`restricted_capabilities\` TEXT NULL, \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pp_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_routing\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`routing_strategy\` ENUM('lowest_latency','lowest_cost','highest_reliability','deterministic_priority','capability_match') NOT NULL DEFAULT 'deterministic_priority',
      \`fallback_strategy\` ENUM('next_provider','mock_fallback','fail_fast','degraded_mode') NOT NULL DEFAULT 'next_provider',
      \`preferred_providers\` TEXT NULL, \`capability_routing\` TEXT NULL,
      \`cost_optimization\` TINYINT(1) NOT NULL DEFAULT 0,
      \`latency_optimization\` TINYINT(1) NOT NULL DEFAULT 0,
      \`resilience_mode\` TINYINT(1) NOT NULL DEFAULT 1, \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pr_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_health_logs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`provider_id\` VARCHAR(20) NOT NULL,
      \`health_status\` ENUM('healthy','degraded','unavailable','unknown') NOT NULL,
      \`latency_ms\` INT NOT NULL DEFAULT 0, \`error_message\` TEXT NULL,
      \`checked_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_phl_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_cost_analytics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`provider_id\` VARCHAR(20) NOT NULL, \`model\` VARCHAR(255) NOT NULL,
      \`prompt_tokens\` INT NOT NULL DEFAULT 0, \`completion_tokens\` INT NOT NULL DEFAULT 0,
      \`total_cost\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pca_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_failover_events\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`failed_provider_id\` VARCHAR(20) NOT NULL, \`new_provider_id\` VARCHAR(20) NULL,
      \`reason\` TEXT NULL,
      \`occurred_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pfe_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_replay_snapshots\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`original_execution_id\` VARCHAR(20) NOT NULL, \`snapshot_key\` VARCHAR(64) NOT NULL,
      \`request_payload\` TEXT NULL, \`response_payload\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_prs_org\` (\`organization_id\`), INDEX \`idx_prs_key\` (\`snapshot_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_usage_quotas\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`daily_limit\` DECIMAL(10,4) NOT NULL DEFAULT 100.0,
      \`monthly_limit\` DECIMAL(10,4) NOT NULL DEFAULT 2000.0,
      \`alert_threshold\` DECIMAL(5,4) NOT NULL DEFAULT 0.8,
      \`active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_puq_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`provider_latency_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`provider_id\` VARCHAR(20) NOT NULL, \`model\` VARCHAR(255) NOT NULL,
      \`latency_ms\` INT NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_plm_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`semantic_chunks\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`document_id\` VARCHAR(255) NOT NULL,
      \`source_type\` VARCHAR(50) NOT NULL DEFAULT 'document',
      \`source_snapshot_id\` VARCHAR(64) NULL,
      \`chunk_index\` INT NOT NULL DEFAULT 0, \`chunk_hash\` VARCHAR(64) NOT NULL,
      \`chunk_text\` TEXT NULL, \`normalized_text\` TEXT NULL,
      \`semantic_metadata\` JSON NULL,
      \`chunk_strategy\` VARCHAR(50) NOT NULL DEFAULT 'paragraph_chunking',
      \`token_count\` INT NOT NULL DEFAULT 0, \`language\` VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_sc_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`vector_embeddings\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`chunk_id\` VARCHAR(20) NOT NULL, \`provider_id\` VARCHAR(255) NOT NULL,
      \`model\` VARCHAR(255) NOT NULL, \`embedding_version\` VARCHAR(20) NOT NULL DEFAULT 'v1',
      \`embedding_vector\` JSON NULL, \`embedding_hash\` VARCHAR(64) NOT NULL,
      \`token_usage\` INT NOT NULL DEFAULT 0, \`generation_latency_ms\` INT NOT NULL DEFAULT 0,
      \`deterministic_snapshot\` VARCHAR(64) NULL, \`correlation_id\` VARCHAR(64) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ve_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`retrieval_sessions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`query_text\` TEXT NULL, \`normalized_query\` TEXT NULL,
      \`retrieval_strategy\` VARCHAR(50) NOT NULL DEFAULT 'vector_similarity',
      \`reranking_enabled\` TINYINT(1) NOT NULL DEFAULT 0,
      \`embedding_version\` VARCHAR(20) NOT NULL DEFAULT 'v1',
      \`retrieved_chunks\` JSON NULL, \`retrieval_trace\` JSON NULL,
      \`explainability_data\` JSON NULL, \`latency_ms\` INT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rses_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`retrieval_evidences\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`retrieval_session_id\` VARCHAR(20) NOT NULL, \`chunk_id\` VARCHAR(20) NOT NULL,
      \`similarity_score\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`bm25_score\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`rerank_score\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`final_score\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`ranking_reason\` TEXT NULL, \`semantic_explanation\` TEXT NULL,
      \`evidence_type\` VARCHAR(50) NOT NULL DEFAULT 'semantic_match',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rev_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`semantic_corpora\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`corpus_type\` VARCHAR(50) NOT NULL DEFAULT 'custom',
      \`corpus_name\` VARCHAR(255) NOT NULL, \`corpus_description\` TEXT NULL,
      \`indexing_strategy\` VARCHAR(50) NOT NULL DEFAULT 'incremental',
      \`embedding_provider\` VARCHAR(255) NOT NULL DEFAULT 'mock',
      \`active_embedding_version\` VARCHAR(20) NOT NULL DEFAULT 'v1',
      \`total_chunks\` INT NOT NULL DEFAULT 0, \`total_embeddings\` INT NOT NULL DEFAULT 0,
      \`indexing_status\` VARCHAR(50) NOT NULL DEFAULT 'pending',
      \`last_indexed_at\` DATETIME(3) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_scorpus_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`embedding_jobs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`corpus_id\` VARCHAR(20) NOT NULL, \`provider_id\` VARCHAR(255) NOT NULL,
      \`model\` VARCHAR(255) NOT NULL,
      \`total_chunks\` INT NOT NULL DEFAULT 0, \`processed_chunks\` INT NOT NULL DEFAULT 0,
      \`failed_chunks\` INT NOT NULL DEFAULT 0,
      \`status\` VARCHAR(50) NOT NULL DEFAULT 'pending',
      \`correlation_id\` VARCHAR(64) NOT NULL,
      \`started_at\` DATETIME(3) NULL, \`completed_at\` DATETIME(3) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ej_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`retrieval_logs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(20) NOT NULL,
      \`operation\` VARCHAR(50) NOT NULL DEFAULT 'search',
      \`latency_ms\` INT NOT NULL DEFAULT 0, \`result_count\` INT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rl_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`reranking_logs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(20) NOT NULL,
      \`strategy\` VARCHAR(50) NOT NULL DEFAULT 'semantic',
      \`candidates_count\` INT NOT NULL DEFAULT 0, \`reranked_count\` INT NOT NULL DEFAULT 0,
      \`latency_ms\` INT NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL,
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rkl_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`semantic_memory_links\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`source_chunk_id\` VARCHAR(20) NOT NULL, \`target_chunk_id\` VARCHAR(20) NOT NULL,
      \`link_type\` VARCHAR(50) NOT NULL DEFAULT 'correlation',
      \`strength\` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
      \`context\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_sml_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`reindex_jobs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`corpus_id\` VARCHAR(20) NOT NULL,
      \`reindex_type\` VARCHAR(50) NOT NULL DEFAULT 'full_reindex',
      \`status\` VARCHAR(50) NOT NULL DEFAULT 'pending',
      \`from_version\` VARCHAR(20) NOT NULL, \`to_version\` VARCHAR(20) NOT NULL,
      \`total_chunks\` INT NOT NULL DEFAULT 0, \`processed_chunks\` INT NOT NULL DEFAULT 0,
      \`failed_chunks\` INT NOT NULL DEFAULT 0,
      \`requires_approval\` TINYINT(1) NOT NULL DEFAULT 0,
      \`approved_by\` VARCHAR(255) NULL, \`correlation_id\` VARCHAR(64) NOT NULL,
      \`started_at\` DATETIME(3) NULL, \`completed_at\` DATETIME(3) NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rj_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`vector_health_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`corpus_id\` VARCHAR(20) NOT NULL,
      \`total_chunks\` INT NOT NULL DEFAULT 0, \`total_embeddings\` INT NOT NULL DEFAULT 0,
      \`orphan_embeddings\` INT NOT NULL DEFAULT 0, \`stale_embeddings\` INT NOT NULL DEFAULT 0,
      \`avg_similarity_score\` DECIMAL(10,6) NOT NULL DEFAULT 0,
      \`index_health\` VARCHAR(50) NOT NULL DEFAULT 'healthy',
      \`recorded_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_vhm_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 4.7: Institutional RAG Engine ──────────────────────────────

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_queries\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workflow_id\` VARCHAR(20) NULL, \`user_id\` VARCHAR(255) NOT NULL,
      \`query\` TEXT NULL, \`normalized_query\` TEXT NULL,
      \`intent\` VARCHAR(50) NOT NULL DEFAULT 'general',
      \`query_type\` VARCHAR(50) NOT NULL DEFAULT 'factual',
      \`context_strategy\` VARCHAR(50) NOT NULL DEFAULT 'selective',
      \`retrieval_strategy\` VARCHAR(50) NOT NULL DEFAULT 'hybrid',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_iq_org\` (\`organization_id\`),
      INDEX \`idx_iq_user\` (\`user_id\`), INDEX \`idx_iq_intent\` (\`intent\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`context_assemblies\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`query_id\` VARCHAR(20) NOT NULL,
      \`retrieved_chunks\` JSON NULL, \`legal_references\` JSON NULL,
      \`municipality_history\` JSON NULL, \`similar_trs\` JSON NULL,
      \`semantic_evidence\` JSON NULL, \`prompt_context\` TEXT NULL,
      \`total_tokens\` INT NOT NULL DEFAULT 0,
      \`assembly_strategy\` VARCHAR(50) NOT NULL DEFAULT 'selective',
      \`compression_applied\` TINYINT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ca_org\` (\`organization_id\`),
      INDEX \`idx_ca_query\` (\`query_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_evidences\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`source_type\` VARCHAR(50) NOT NULL DEFAULT 'lei_14133',
      \`source_id\` VARCHAR(255) NOT NULL DEFAULT '',
      \`law_reference\` VARCHAR(255) NOT NULL DEFAULT '',
      \`article\` VARCHAR(100) NOT NULL DEFAULT '',
      \`clause\` VARCHAR(100) NULL, \`paragraph\` VARCHAR(100) NULL,
      \`jurisprudence_reference\` VARCHAR(500) NULL,
      \`text\` TEXT NULL, \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`explanation\` TEXT NULL, \`tags\` JSON NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_le_org\` (\`organization_id\`),
      INDEX \`idx_le_source\` (\`source_type\`), INDEX \`idx_le_law\` (\`law_reference\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`grounding_sessions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`query_id\` VARCHAR(20) NOT NULL, \`provider_execution_id\` VARCHAR(20) NULL,
      \`grounding_version\` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      \`evidence_graph\` JSON NULL, \`final_prompt\` TEXT NULL,
      \`grounding_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`confidence_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`replay_snapshot\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gsess_org\` (\`organization_id\`),
      INDEX \`idx_gsess_query\` (\`query_id\`), INDEX \`idx_gsess_corr\` (\`correlation_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`response_citations\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`response_id\` VARCHAR(20) NOT NULL, \`evidence_id\` VARCHAR(20) NULL,
      \`chunk_id\` VARCHAR(20) NULL, \`citation_text\` TEXT NULL,
      \`source_document\` VARCHAR(500) NOT NULL DEFAULT '',
      \`page\` VARCHAR(50) NULL, \`section\` VARCHAR(255) NULL,
      \`similarity\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`citation_type\` VARCHAR(50) NOT NULL DEFAULT 'direct_quote',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rcit_org\` (\`organization_id\`),
      INDEX \`idx_rcit_response\` (\`response_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`response_validations\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`response_id\` VARCHAR(20) NOT NULL,
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`hallucination_risk\` VARCHAR(50) NOT NULL DEFAULT 'none',
      \`unsupported_claims\` JSON NULL, \`contradictions\` JSON NULL,
      \`missing_evidence\` JSON NULL,
      \`validation_result\` VARCHAR(50) NOT NULL DEFAULT 'approved',
      \`requires_human_approval\` TINYINT NOT NULL DEFAULT 0,
      \`validation_explanation\` TEXT NULL,
      \`grounding_coverage\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`evidence_utilization\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rval_org\` (\`organization_id\`),
      INDEX \`idx_rval_response\` (\`response_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`confidence_scores\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`query_id\` VARCHAR(20) NOT NULL,
      \`retrieval_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`evidence_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`legal_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`grounding_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`response_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`consolidated_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`weights\` JSON NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cs_org\` (\`organization_id\`),
      INDEX \`idx_cs_query\` (\`query_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`evidence_graphs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`grounding_session_id\` VARCHAR(20) NOT NULL,
      \`nodes\` JSON NULL, \`edges\` JSON NULL,
      \`version\` VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_eg_org\` (\`organization_id\`),
      INDEX \`idx_eg_session\` (\`grounding_session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`rag_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`operation\` VARCHAR(100) NOT NULL DEFAULT '',
      \`retrieval_ms\` INT NOT NULL DEFAULT 0, \`grounding_ms\` INT NOT NULL DEFAULT 0,
      \`inference_ms\` INT NOT NULL DEFAULT 0, \`total_ms\` INT NOT NULL DEFAULT 0,
      \`chunk_count\` INT NOT NULL DEFAULT 0, \`evidence_count\` INT NOT NULL DEFAULT 0,
      \`token_count\` INT NOT NULL DEFAULT 0,
      \`confidence_score\` DECIMAL(5,4) NOT NULL DEFAULT 0.0,
      \`hallucination_risk\` VARCHAR(50) NOT NULL DEFAULT 'none',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rm_org\` (\`organization_id\`),
      INDEX \`idx_rm_corr\` (\`correlation_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`grounding_logs\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`grounding_session_id\` VARCHAR(20) NOT NULL,
      \`log_level\` VARCHAR(20) NOT NULL DEFAULT 'info',
      \`message\` TEXT NULL, \`metadata\` JSON NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gl_org\` (\`organization_id\`),
      INDEX \`idx_gl_session\` (\`grounding_session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 4.8 — Procurement Knowledge Graph ──────────────────────────────

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`knowledge_nodes\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`node_type\` VARCHAR(50) NOT NULL DEFAULT 'concept',
      \`external_id\` VARCHAR(255) NULL,
      \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`normalized_title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`description\` TEXT NULL, \`aliases\` TEXT NULL, \`metadata\` TEXT NULL,
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 1.0,
      \`source\` VARCHAR(100) NOT NULL DEFAULT 'manual',
      \`version\` INT NOT NULL DEFAULT 1,
      \`active\` TINYINT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_kn_org\` (\`organization_id\`),
      INDEX \`idx_kn_type\` (\`node_type\`),
      INDEX \`idx_kn_title\` (\`normalized_title\`(191)),
      INDEX \`idx_kn_org_active\` (\`organization_id\`, \`active\`),
      INDEX \`idx_kn_org_type\` (\`organization_id\`, \`node_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`knowledge_edges\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`source_node_id\` VARCHAR(20) NOT NULL,
      \`target_node_id\` VARCHAR(20) NOT NULL,
      \`relationship_type\` VARCHAR(50) NOT NULL DEFAULT 'related_to',
      \`weight\` DECIMAL(5,4) NOT NULL DEFAULT 1.0,
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 1.0,
      \`justification\` TEXT NULL,
      \`provenance\` VARCHAR(100) NOT NULL DEFAULT 'manual',
      \`direction\` VARCHAR(20) NOT NULL DEFAULT 'unidirectional',
      \`active\` TINYINT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ke_org\` (\`organization_id\`),
      INDEX \`idx_ke_source\` (\`source_node_id\`),
      INDEX \`idx_ke_target\` (\`target_node_id\`),
      INDEX \`idx_ke_type\` (\`relationship_type\`),
      INDEX \`idx_ke_org_source\` (\`organization_id\`, \`source_node_id\`),
      INDEX \`idx_ke_org_target\` (\`organization_id\`, \`target_node_id\`),
      INDEX \`idx_ke_org_active\` (\`organization_id\`, \`active\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_reference_nodes\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`reference_type\` VARCHAR(50) NOT NULL DEFAULT 'lei',
      \`numero\` VARCHAR(50) NOT NULL DEFAULT '',
      \`ano\` INT NOT NULL DEFAULT 0,
      \`orgao\` VARCHAR(255) NOT NULL DEFAULT '',
      \`artigo\` VARCHAR(100) NULL, \`inciso\` VARCHAR(100) NULL,
      \`alinea\` VARCHAR(100) NULL, \`texto\` TEXT NULL,
      \`vigencia\` VARCHAR(50) NOT NULL DEFAULT 'vigente',
      \`ementa\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_lrn_org\` (\`organization_id\`),
      INDEX \`idx_lrn_type\` (\`reference_type\`),
      INDEX \`idx_lrn_numero\` (\`numero\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`procurement_concepts\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`category\` VARCHAR(50) NOT NULL DEFAULT 'conceito',
      \`name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`normalized_name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`definition\` TEXT NULL,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`parent_concept_id\` VARCHAR(20) NULL,
      \`aliases\` TEXT NULL, \`examples\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pcon_org\` (\`organization_id\`),
      INDEX \`idx_pcon_cat\` (\`category\`),
      INDEX \`idx_pcon_parent\` (\`parent_concept_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`clause_knowledge\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`category\` VARCHAR(50) NOT NULL DEFAULT 'objeto',
      \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`content\` TEXT NULL, \`purpose\` TEXT NULL,
      \`risk_level\` VARCHAR(20) NOT NULL DEFAULT 'baixo',
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`related_document_types\` TEXT NULL, \`prerequisites\` TEXT NULL,
      \`active\` TINYINT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_clk_org\` (\`organization_id\`),
      INDEX \`idx_clk_cat\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`entity_resolutions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`source_entity_id\` VARCHAR(20) NOT NULL,
      \`target_entity_id\` VARCHAR(20) NOT NULL,
      \`strategy\` VARCHAR(50) NOT NULL DEFAULT 'fuzzy',
      \`status\` VARCHAR(50) NOT NULL DEFAULT 'pending',
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
      \`reasoning\` TEXT NULL,
      \`resolved_by\` VARCHAR(255) NOT NULL DEFAULT 'system',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_er_org\` (\`organization_id\`),
      INDEX \`idx_er_source\` (\`source_entity_id\`),
      INDEX \`idx_er_target\` (\`target_entity_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`ontology_taxonomy\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`category\` VARCHAR(50) NOT NULL DEFAULT '',
      \`parent_id\` VARCHAR(20) NULL, \`definition\` TEXT NULL,
      \`legal_basis\` VARCHAR(500) NOT NULL DEFAULT '',
      \`aliases\` TEXT NULL,
      \`level\` INT NOT NULL DEFAULT 0,
      \`sort_order\` INT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ot_org\` (\`organization_id\`),
      INDEX \`idx_ot_parent\` (\`parent_id\`),
      INDEX \`idx_ot_cat\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`graph_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`metric_name\` VARCHAR(100) NOT NULL DEFAULT '',
      \`metric_value\` DECIMAL(10,4) NOT NULL DEFAULT 0,
      \`metric_unit\` VARCHAR(50) NOT NULL DEFAULT 'count',
      \`tags\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gm_org\` (\`organization_id\`),
      INDEX \`idx_gm_name\` (\`metric_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`graph_versions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`version_number\` INT NOT NULL DEFAULT 1,
      \`node_count\` INT NOT NULL DEFAULT 0,
      \`edge_count\` INT NOT NULL DEFAULT 0,
      \`change_summary\` TEXT NULL,
      \`created_by\` VARCHAR(255) NOT NULL DEFAULT 'system',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gv_org\` (\`organization_id\`),
      INDEX \`idx_gv_version\` (\`version_number\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`graph_change_log\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`entity_type\` VARCHAR(50) NOT NULL DEFAULT 'node',
      \`entity_id\` VARCHAR(20) NOT NULL,
      \`operation\` VARCHAR(50) NOT NULL DEFAULT 'create',
      \`before_state\` TEXT NULL, \`after_state\` TEXT NULL,
      \`changed_by\` VARCHAR(255) NOT NULL DEFAULT 'system',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gcl_org\` (\`organization_id\`),
      INDEX \`idx_gcl_entity\` (\`entity_id\`),
      INDEX \`idx_gcl_op\` (\`operation\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 4.9 — Institutional Cognitive Copilots ───────────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilots\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`copilot_type\` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
      \`name\` VARCHAR(255) NOT NULL DEFAULT '', \`description\` TEXT NULL,
      \`domain\` VARCHAR(100) NOT NULL DEFAULT '',
      \`capabilities\` TEXT NULL, \`permissions\` TEXT NULL, \`forbidden_actions\` TEXT NULL,
      \`active\` TINYINT NOT NULL DEFAULT 1, \`version\` INT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cop_org\` (\`organization_id\`),
      INDEX \`idx_cop_type\` (\`copilot_type\`),
      INDEX \`idx_cop_org_type\` (\`organization_id\`, \`copilot_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilot_sessions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workflow_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`copilot_id\` VARCHAR(20) NOT NULL,
      \`copilot_type\` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
      \`user_id\` INT NOT NULL DEFAULT 0,
      \`context_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`reasoning_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`query\` TEXT NULL, \`status\` VARCHAR(30) NOT NULL DEFAULT 'open',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cps_org\` (\`organization_id\`),
      INDEX \`idx_cps_copilot\` (\`copilot_id\`),
      INDEX \`idx_cps_status\` (\`status\`),
      INDEX \`idx_cps_org_copilot\` (\`organization_id\`, \`copilot_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilot_recommendations\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(20) NOT NULL,
      \`copilot_type\` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'orientacao',
      \`summary\` TEXT NULL, \`suggestions\` TEXT NULL, \`risks\` TEXT NULL,
      \`alternatives\` TEXT NULL, \`justification\` TEXT NULL,
      \`legal_basis\` TEXT NULL, \`evidence_ids\` TEXT NULL,
      \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
      \`requires_human_review\` TINYINT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_crec_org\` (\`organization_id\`),
      INDEX \`idx_crec_session\` (\`session_id\`),
      INDEX \`idx_crec_org_session\` (\`organization_id\`, \`session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilot_decision_traces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`session_id\` VARCHAR(20) NOT NULL,
      \`reasoning_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`steps\` TEXT NULL, \`replay_snapshot\` VARCHAR(64) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ctr_org\` (\`organization_id\`),
      INDEX \`idx_ctr_session\` (\`session_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilot_policies\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`copilot_type\` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
      \`name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`allowed_actions\` TEXT NULL, \`forbidden_actions\` TEXT NULL,
      \`min_confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.4,
      \`approval_risk_threshold\` VARCHAR(20) NOT NULL DEFAULT 'alto',
      \`active\` TINYINT NOT NULL DEFAULT 1, \`version\` INT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cpol_org\` (\`organization_id\`),
      INDEX \`idx_cpol_type\` (\`copilot_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`copilot_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`copilot_type\` VARCHAR(50) NOT NULL DEFAULT 'agente_contratacao',
      \`metric_name\` VARCHAR(100) NOT NULL DEFAULT '',
      \`metric_value\` DECIMAL(10,4) NOT NULL DEFAULT 0,
      \`metric_unit\` VARCHAR(50) NOT NULL DEFAULT 'count', \`tags\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cmet_org\` (\`organization_id\`),
      INDEX \`idx_cmet_type\` (\`copilot_type\`),
      INDEX \`idx_cmet_name\` (\`metric_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 5.0 — Cognitive Procurement Workspace ────────────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`cognitive_workspaces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`workspace_type\` VARCHAR(50) NOT NULL DEFAULT 'generico',
      \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'draft',
      \`owner\` INT NOT NULL DEFAULT 0, \`participants\` TEXT NULL,
      \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'planejamento',
      \`active_copilots\` TEXT NULL, \`active_tasks\` TEXT NULL, \`active_documents\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cws_org\` (\`organization_id\`),
      INDEX \`idx_cws_process\` (\`process_id\`), INDEX \`idx_cws_status\` (\`status\`),
      INDEX \`idx_cws_org_status\` (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`workspace_tasks\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL,
      \`task_type\` VARCHAR(50) NOT NULL DEFAULT 'generico',
      \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`assigned_copilot\` VARCHAR(50) NULL, \`assigned_user\` INT NULL,
      \`priority\` VARCHAR(20) NOT NULL DEFAULT 'media',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'pending',
      \`dependencies\` TEXT NULL, \`due_date\` VARCHAR(30) NULL,
      \`approval_required\` TINYINT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_wt_org\` (\`organization_id\`),
      INDEX \`idx_wt_workspace\` (\`workspace_id\`), INDEX \`idx_wt_status\` (\`status\`),
      INDEX \`idx_wt_org_workspace\` (\`organization_id\`, \`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`workspace_timeline\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL,
      \`event_order\` INT NOT NULL DEFAULT 0,
      \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'change',
      \`actor\` VARCHAR(100) NOT NULL DEFAULT 'system',
      \`summary\` TEXT NULL, \`ref_id\` VARCHAR(40) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_wtl_org\` (\`organization_id\`),
      INDEX \`idx_wtl_workspace\` (\`workspace_id\`),
      INDEX \`idx_wtl_org_workspace\` (\`organization_id\`, \`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`workspace_decisions\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL,
      \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`decision\` TEXT NULL, \`justification\` TEXT NULL,
      \`responsible_user\` INT NOT NULL DEFAULT 0,
      \`outcome\` VARCHAR(30) NOT NULL DEFAULT 'adiada',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'registrada',
      \`evidence_ids\` TEXT NULL, \`involved_copilots\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_wd_org\` (\`organization_id\`),
      INDEX \`idx_wd_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`workspace_risks\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL,
      \`category\` VARCHAR(30) NOT NULL DEFAULT 'operacional',
      \`description\` TEXT NULL, \`severity\` VARCHAR(20) NOT NULL DEFAULT 'medio',
      \`likelihood\` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'identificado',
      \`mitigation\` TEXT NULL, \`correlated_risk_ids\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_wr_org\` (\`organization_id\`),
      INDEX \`idx_wr_workspace\` (\`workspace_id\`), INDEX \`idx_wr_severity\` (\`severity\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`workspace_metrics\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`metric_name\` VARCHAR(100) NOT NULL DEFAULT '',
      \`metric_value\` DECIMAL(10,4) NOT NULL DEFAULT 0,
      \`metric_unit\` VARCHAR(50) NOT NULL DEFAULT 'count', \`tags\` TEXT NULL,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_wm_org\` (\`organization_id\`),
      INDEX \`idx_wm_workspace\` (\`workspace_id\`), INDEX \`idx_wm_name\` (\`metric_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 5.0.1 — Business Domain Architecture & Modular Licensing ──────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`business_domains\` (
      \`id\` VARCHAR(20) NOT NULL, \`code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`name\` VARCHAR(255) NOT NULL DEFAULT '', \`description\` TEXT NULL,
      \`category\` VARCHAR(30) NOT NULL DEFAULT 'core',
      \`active\` TINYINT NOT NULL DEFAULT 1, \`version\` INT NOT NULL DEFAULT 1,
      \`dependencies\` TEXT NULL, \`required_kernel_services\` TEXT NULL,
      \`supported_workflows\` TEXT NULL,
      \`workspace_type\` VARCHAR(50) NOT NULL DEFAULT 'generico',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_bd_code\` (\`code\`),
      INDEX \`idx_bd_category\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`domain_workspaces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`business_domain_id\` VARCHAR(20) NOT NULL,
      \`business_domain_code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`workspace_type\` VARCHAR(50) NOT NULL DEFAULT 'generico',
      \`current_workflow\` VARCHAR(50) NOT NULL DEFAULT '',
      \`active_copilots\` TEXT NULL, \`active_documents\` TEXT NULL, \`active_tasks\` TEXT NULL,
      \`permissions\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_dws_org\` (\`organization_id\`),
      INDEX \`idx_dws_domain\` (\`business_domain_code\`),
      INDEX \`idx_dws_org_domain\` (\`organization_id\`, \`business_domain_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`licensed_modules\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`business_domain_code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`plan\` VARCHAR(30) NOT NULL DEFAULT 'trial',
      \`active\` TINYINT NOT NULL DEFAULT 1,
      \`activation_date\` VARCHAR(30) NOT NULL DEFAULT '',
      \`expiration_date\` VARCHAR(30) NULL, \`licensed_features\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_lm_org\` (\`organization_id\`),
      INDEX \`idx_lm_domain\` (\`business_domain_code\`),
      INDEX \`idx_lm_org_domain\` (\`organization_id\`, \`business_domain_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`module_dependencies\` (
      \`id\` VARCHAR(20) NOT NULL, \`dependent_code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`kind\` VARCHAR(20) NOT NULL DEFAULT 'domain',
      \`depends_on\` VARCHAR(50) NOT NULL DEFAULT '', \`required\` TINYINT NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_mdep_dependent\` (\`dependent_code\`),
      INDEX \`idx_mdep_kind\` (\`kind\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`module_feature_flags\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`business_domain_code\` VARCHAR(50) NULL,
      \`feature_key\` VARCHAR(100) NOT NULL DEFAULT '',
      \`enabled\` TINYINT NOT NULL DEFAULT 0,
      \`rollout_strategy\` VARCHAR(20) NOT NULL DEFAULT 'off',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_mff_org\` (\`organization_id\`),
      INDEX \`idx_mff_key\` (\`feature_key\`),
      INDEX \`idx_mff_org_key\` (\`organization_id\`, \`feature_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`organization_features\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`feature_key\` VARCHAR(100) NOT NULL DEFAULT '',
      \`enabled\` TINYINT NOT NULL DEFAULT 0,
      \`source\` VARCHAR(50) NOT NULL DEFAULT 'license',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_of_org\` (\`organization_id\`),
      INDEX \`idx_of_org_key\` (\`organization_id\`, \`feature_key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`kernel_services\` (
      \`id\` VARCHAR(20) NOT NULL, \`service_id\` VARCHAR(60) NOT NULL DEFAULT '',
      \`name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`category\` VARCHAR(30) NOT NULL DEFAULT 'platform',
      \`active\` TINYINT NOT NULL DEFAULT 1,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), UNIQUE KEY \`uq_ks_service\` (\`service_id\`),
      INDEX \`idx_ks_category\` (\`category\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`domain_navigation\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`business_domain_code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`visible\` TINYINT NOT NULL DEFAULT 1, \`sort_order\` INT NOT NULL DEFAULT 0,
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_dnav_org\` (\`organization_id\`),
      INDEX \`idx_dnav_org_visible\` (\`organization_id\`, \`visible\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Sprint 5.1 — Business Domain: Processo Licitatório ──────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`procurement_processes\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_number\` VARCHAR(64) NOT NULL DEFAULT '', \`object\` TEXT NULL,
      \`modality\` VARCHAR(50) NOT NULL DEFAULT '',
      \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'rascunho',
      \`start_option\` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
      \`responsible_user\` INT NOT NULL DEFAULT 0, \`participants\` TEXT NULL, \`active_copilots\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pp_org\` (\`organization_id\`),
      INDEX \`idx_pp_number\` (\`process_number\`), INDEX \`idx_pp_stage\` (\`current_stage\`),
      INDEX \`idx_pp_org_status\` (\`organization_id\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`process_stages\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`stage\` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
      \`state\` VARCHAR(30) NOT NULL DEFAULT '', \`entered_at\` VARCHAR(30) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ps_org\` (\`organization_id\`), INDEX \`idx_ps_process\` (\`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`price_research\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`source\` VARCHAR(20) NOT NULL DEFAULT 'manual',
      \`item_count\` INT NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pr_org\` (\`organization_id\`), INDEX \`idx_pr_process\` (\`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`price_research_items\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`research_id\` VARCHAR(20) NOT NULL, \`process_id\` VARCHAR(20) NOT NULL,
      \`description\` TEXT NULL, \`quantity\` DECIMAL(14,3) NOT NULL DEFAULT 0,
      \`unit\` VARCHAR(30) NOT NULL DEFAULT 'un', \`supplier\` VARCHAR(255) NOT NULL DEFAULT '',
      \`brand\` VARCHAR(255) NOT NULL DEFAULT '', \`model\` VARCHAR(255) NOT NULL DEFAULT '',
      \`value\` DECIMAL(14,2) NOT NULL DEFAULT 0, \`observations\` TEXT NULL,
      \`source\` VARCHAR(50) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pri_org\` (\`organization_id\`),
      INDEX \`idx_pri_research\` (\`research_id\`), INDEX \`idx_pri_process\` (\`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`intelligent_items\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`source_research_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`description\` TEXT NULL, \`quantity\` DECIMAL(14,3) NOT NULL DEFAULT 0,
      \`unit\` VARCHAR(30) NOT NULL DEFAULT 'un', \`average_price\` DECIMAL(14,2) NOT NULL DEFAULT 0,
      \`suppliers\` TEXT NULL, \`suggested_catmat\` VARCHAR(50) NULL, \`alternative_catmat\` TEXT NULL,
      \`specifications\` TEXT NULL, \`risks\` TEXT NULL, \`recommendations\` TEXT NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'pendente', \`approved_by\` INT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ii_org\` (\`organization_id\`),
      INDEX \`idx_ii_process\` (\`process_id\`), INDEX \`idx_ii_status\` (\`status\`),
      INDEX \`idx_ii_org_process\` (\`organization_id\`, \`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`item_catmat_matches\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`item_id\` VARCHAR(20) NOT NULL, \`catmat_code\` VARCHAR(50) NOT NULL DEFAULT '',
      \`catmat_description\` TEXT NULL, \`score\` DECIMAL(5,4) NOT NULL DEFAULT 0,
      \`match_rank\` INT NOT NULL DEFAULT 0, \`decision\` VARCHAR(20) NOT NULL DEFAULT 'sugerido',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_icm_org\` (\`organization_id\`), INDEX \`idx_icm_item\` (\`item_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`item_recommendations\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`item_id\` VARCHAR(20) NOT NULL, \`rec_type\` VARCHAR(30) NOT NULL DEFAULT 'catmat',
      \`summary\` TEXT NULL, \`reasoning\` TEXT NULL, \`explainability\` TEXT NULL,
      \`provenance\` VARCHAR(100) NOT NULL DEFAULT 'kernel', \`confidence\` DECIMAL(5,4) NOT NULL DEFAULT 0.5,
      \`accepted\` TINYINT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ir_org\` (\`organization_id\`), INDEX \`idx_ir_item\` (\`item_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`item_risks\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`item_id\` VARCHAR(20) NOT NULL, \`risk_type\` VARCHAR(40) NOT NULL DEFAULT 'inconsistencia',
      \`severity\` VARCHAR(20) NOT NULL DEFAULT 'medio', \`description\` TEXT NULL, \`explanation\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_irk_org\` (\`organization_id\`), INDEX \`idx_irk_item\` (\`item_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`item_history\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`item_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`object\` TEXT NULL, \`year\` INT NOT NULL DEFAULT 0,
      \`winning_supplier\` VARCHAR(255) NOT NULL DEFAULT '', \`homologated_price\` DECIMAL(14,2) NOT NULL DEFAULT 0,
      \`catmat_used\` VARCHAR(50) NOT NULL DEFAULT '', \`outcome\` VARCHAR(30) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ih_org\` (\`organization_id\`), INDEX \`idx_ih_process\` (\`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`process_timeline\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`event_order\` INT NOT NULL DEFAULT 0,
      \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'change', \`actor\` VARCHAR(100) NOT NULL DEFAULT 'system',
      \`summary\` TEXT NULL, \`ref_id\` VARCHAR(40) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ptl_org\` (\`organization_id\`),
      INDEX \`idx_ptl_process\` (\`process_id\`), INDEX \`idx_ptl_org_process\` (\`organization_id\`, \`process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`generated_documents\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_id\` VARCHAR(20) NOT NULL, \`kind\` VARCHAR(20) NOT NULL DEFAULT 'etp',
      \`title\` VARCHAR(500) NOT NULL DEFAULT '', \`content\` TEXT NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'rascunho', \`sources\` TEXT NULL,
      \`modality\` VARCHAR(40) NULL, \`form\` VARCHAR(20) NULL, \`platform\` VARCHAR(40) NULL,
      \`legal_justification\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_gd_org\` (\`organization_id\`),
      INDEX \`idx_gd_process\` (\`process_id\`), INDEX \`idx_gd_kind\` (\`kind\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // ─── Kernel — Institutional Request Engine ───────────────────────────────
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_requests\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`source_domain\` VARCHAR(50) NOT NULL DEFAULT '', \`destination_domain\` VARCHAR(50) NOT NULL DEFAULT '',
      \`request_type\` VARCHAR(40) NOT NULL DEFAULT 'INFORMATION_REQUEST',
      \`reference_process_id\` VARCHAR(20) NOT NULL DEFAULT '', \`reference_document_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`title\` VARCHAR(500) NOT NULL DEFAULT '', \`description\` TEXT NULL,
      \`priority\` VARCHAR(20) NOT NULL DEFAULT 'media', \`status\` VARCHAR(30) NOT NULL DEFAULT 'NEW',
      \`requested_by\` INT NOT NULL DEFAULT 0, \`assigned_to\` INT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ireq_org\` (\`organization_id\`),
      INDEX \`idx_ireq_dest\` (\`destination_domain\`), INDEX \`idx_ireq_src\` (\`source_domain\`),
      INDEX \`idx_ireq_status\` (\`status\`), INDEX \`idx_ireq_org_dest\` (\`organization_id\`, \`destination_domain\`),
      INDEX \`idx_ireq_process\` (\`reference_process_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_responses\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`responder\` INT NOT NULL DEFAULT 0,
      \`response_type\` VARCHAR(30) NOT NULL DEFAULT 'informacao',
      \`response_status\` VARCHAR(30) NOT NULL DEFAULT 'concluido',
      \`comments\` TEXT NULL, \`attached_documents\` TEXT NULL,
      \`signed\` TINYINT NOT NULL DEFAULT 0, \`signature_method\` VARCHAR(30) NULL, \`signed_at\` VARCHAR(30) NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ires_org\` (\`organization_id\`), INDEX \`idx_ires_request\` (\`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`request_assignments\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`user_id\` INT NULL,
      \`sector\` VARCHAR(100) NOT NULL DEFAULT '', \`queue\` VARCHAR(100) NOT NULL DEFAULT 'geral',
      \`priority\` VARCHAR(20) NOT NULL DEFAULT 'media', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rasg_org\` (\`organization_id\`), INDEX \`idx_rasg_request\` (\`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`request_timelines\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`event_order\` INT NOT NULL DEFAULT 0,
      \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'created', \`actor\` VARCHAR(100) NOT NULL DEFAULT 'system',
      \`summary\` TEXT NULL, \`ref_id\` VARCHAR(40) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rtl_org\` (\`organization_id\`),
      INDEX \`idx_rtl_request\` (\`request_id\`), INDEX \`idx_rtl_org_request\` (\`organization_id\`, \`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`request_notifications\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`recipient_user\` INT NOT NULL DEFAULT 0,
      \`channel\` VARCHAR(20) NOT NULL DEFAULT 'sistema', \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`message\` TEXT NULL, \`status\` VARCHAR(20) NOT NULL DEFAULT 'pendente', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rnot_org\` (\`organization_id\`),
      INDEX \`idx_rnot_request\` (\`request_id\`), INDEX \`idx_rnot_recipient\` (\`recipient_user\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`document_references\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`origin_domain\` VARCHAR(50) NOT NULL DEFAULT '',
      \`document_id\` VARCHAR(20) NOT NULL DEFAULT '', \`version\` INT NOT NULL DEFAULT 1,
      \`snapshot\` VARCHAR(64) NOT NULL DEFAULT '', \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_docref_org\` (\`organization_id\`), INDEX \`idx_docref_request\` (\`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // FASE 5 — Business Domain: Parecer Jurídico (workspace-cêntrico)
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_opinion_workspaces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`request_id\` VARCHAR(20) NOT NULL, \`source_domain\` VARCHAR(50) NOT NULL DEFAULT '',
      \`reference_process_id\` VARCHAR(64) NOT NULL DEFAULT '', \`request_type\` VARCHAR(50) NOT NULL DEFAULT '',
      \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'INBOX', \`status\` VARCHAR(30) NOT NULL DEFAULT 'na_caixa',
      \`assigned_lawyer\` INT NULL, \`responsible_sector\` VARCHAR(120) NOT NULL DEFAULT '',
      \`priority\` VARCHAR(20) NOT NULL DEFAULT 'media', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_low_org\` (\`organization_id\`),
      INDEX \`idx_low_request\` (\`request_id\`), INDEX \`idx_low_org_stage\` (\`organization_id\`, \`current_stage\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_opinion_drafts\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL, \`request_id\` VARCHAR(20) NOT NULL,
      \`opinion_type\` VARCHAR(40) NOT NULL DEFAULT 'LEGAL_OPINION_INITIAL',
      \`report\` TEXT NULL, \`foundation\` TEXT NULL, \`conclusion\` TEXT NULL,
      \`conclusion_type\` VARCHAR(30) NULL, \`recommendations\` TEXT NULL, \`reservations\` TEXT NULL, \`attachments\` TEXT NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'rascunho', \`version\` INT NOT NULL DEFAULT 1,
      \`signed\` INT NOT NULL DEFAULT 0, \`signature_method\` VARCHAR(30) NULL, \`signed_by\` INT NULL, \`signed_at\` VARCHAR(40) NULL,
      \`author\` INT NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_lod_org\` (\`organization_id\`),
      INDEX \`idx_lod_workspace\` (\`workspace_id\`), INDEX \`idx_lod_request\` (\`request_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_opinion_versions\` (
      \`id\` VARCHAR(32) NOT NULL, \`organization_id\` INT NOT NULL,
      \`draft_id\` VARCHAR(20) NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`version\` INT NOT NULL DEFAULT 1, \`content_hash\` VARCHAR(64) NOT NULL DEFAULT '',
      \`snapshot\` TEXT NULL, \`author\` INT NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_lov_org\` (\`organization_id\`),
      INDEX \`idx_lov_draft\` (\`draft_id\`), INDEX \`idx_lov_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_opinion_templates\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`name\` VARCHAR(255) NOT NULL DEFAULT '', \`opinion_type\` VARCHAR(40) NOT NULL DEFAULT 'LEGAL_OPINION_INITIAL',
      \`report_template\` TEXT NULL, \`foundation_template\` TEXT NULL, \`conclusion_template\` TEXT NULL,
      \`active\` INT NOT NULL DEFAULT 1, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_lot_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`legal_opinion_history\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL, \`event_order\` INT NOT NULL DEFAULT 0,
      \`event_type\` VARCHAR(50) NOT NULL DEFAULT '', \`actor\` VARCHAR(60) NOT NULL DEFAULT '',
      \`summary\` TEXT NULL, \`ref_id\` VARCHAR(64) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_loh_org\` (\`organization_id\`),
      INDEX \`idx_loh_workspace\` (\`workspace_id\`), INDEX \`idx_loh_ws_order\` (\`workspace_id\`, \`event_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`lawyer_assignments\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`workspace_id\` VARCHAR(20) NOT NULL, \`request_id\` VARCHAR(20) NOT NULL,
      \`lawyer_id\` INT NULL, \`sector\` VARCHAR(120) NOT NULL DEFAULT '', \`priority\` VARCHAR(20) NOT NULL DEFAULT 'media',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`assigned_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_las_org\` (\`organization_id\`),
      INDEX \`idx_las_workspace\` (\`workspace_id\`), INDEX \`idx_las_lawyer\` (\`lawyer_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // FASE 5 — Business Domain: Contratação Direta (Dispensa/Inexigibilidade)
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`direct_procurement_workspaces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`process_number\` VARCHAR(60) NOT NULL DEFAULT '', \`object\` TEXT NULL,
      \`procurement_type\` VARCHAR(30) NOT NULL DEFAULT 'dispensa', \`procedure_type\` VARCHAR(20) NOT NULL DEFAULT 'indefinido',
      \`legal_basis\` VARCHAR(255) NOT NULL DEFAULT '', \`start_option\` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
      \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'NEW', \`status\` VARCHAR(30) NOT NULL DEFAULT 'rascunho',
      \`responsible_user\` INT NOT NULL DEFAULT 0, \`participants\` TEXT NULL, \`active_copilots\` TEXT NULL, \`flags\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_dpw_org\` (\`organization_id\`),
      INDEX \`idx_dpw_org_stage\` (\`organization_id\`, \`current_stage\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`direct_procurement_procedures\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`procedure_type\` VARCHAR(20) NOT NULL DEFAULT 'eletronico', \`platform\` VARCHAR(30) NULL, \`receipt_method\` VARCHAR(30) NULL,
      \`instructions\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_dpp_org\` (\`organization_id\`), INDEX \`idx_dpp_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`proposal_collections\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`supplier_name\` VARCHAR(255) NOT NULL DEFAULT '', \`supplier_document\` VARCHAR(40) NOT NULL DEFAULT '',
      \`proposal_value\` DECIMAL(15,2) NOT NULL DEFAULT 0, \`protocol\` VARCHAR(120) NOT NULL DEFAULT '',
      \`received_via\` VARCHAR(30) NOT NULL DEFAULT 'protocolo', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_prc_org\` (\`organization_id\`), INDEX \`idx_prc_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`proposal_documents\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`proposal_id\` VARCHAR(20) NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'proposta_pdf', \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`document_reference\` VARCHAR(500) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_prd_org\` (\`organization_id\`), INDEX \`idx_prd_proposal\` (\`proposal_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_justifications\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`need\` TEXT NULL, \`public_interest\` TEXT NULL, \`motivation\` TEXT NULL, \`legal_foundation\` TEXT NULL,
      \`benefits\` TEXT NULL, \`alternatives\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cjs_org\` (\`organization_id\`), INDEX \`idx_cjs_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`price_justifications\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`source\` VARCHAR(20) NOT NULL DEFAULT 'pesquisa', \`justification\` TEXT NULL,
      \`reference_value\` DECIMAL(15,2) NOT NULL DEFAULT 0, \`research_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`document_references\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pjs_org\` (\`organization_id\`), INDEX \`idx_pjs_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`required_documents\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`name\` VARCHAR(500) NOT NULL DEFAULT '', \`required\` INT NOT NULL DEFAULT 1, \`status\` VARCHAR(20) NOT NULL DEFAULT 'pendente',
      \`document_reference\` VARCHAR(500) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rqd_org\` (\`organization_id\`), INDEX \`idx_rqd_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`ratifications\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`responsible\` INT NOT NULL DEFAULT 0, \`decision\` VARCHAR(30) NOT NULL DEFAULT 'ratificado', \`justification\` TEXT NULL,
      \`evidence\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`ratified_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_rat_org\` (\`organization_id\`), INDEX \`idx_rat_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`generated_publications\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`workspace_id\` VARCHAR(20) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'aviso', \`title\` VARCHAR(500) NOT NULL DEFAULT '', \`content\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_pub_org\` (\`organization_id\`), INDEX \`idx_pub_workspace\` (\`workspace_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // FASE 5 — Business Domain: Contratos e Instrumentos Contratuais
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_workspaces\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`origin_type\` VARCHAR(30) NOT NULL DEFAULT 'externo', \`origin_process\` VARCHAR(64) NOT NULL DEFAULT '',
      \`contract_number\` VARCHAR(80) NOT NULL DEFAULT '', \`contractor\` VARCHAR(255) NOT NULL DEFAULT '',
      \`object\` TEXT NULL, \`value\` DECIMAL(15,2) NOT NULL DEFAULT 0, \`term\` VARCHAR(255) NOT NULL DEFAULT '',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'minuta', \`manager\` VARCHAR(255) NOT NULL DEFAULT '', \`inspector\` VARCHAR(255) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ctw_org\` (\`organization_id\`),
      INDEX \`idx_ctw_org_origin\` (\`organization_id\`, \`origin_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_ws_documents\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`contract_id\` VARCHAR(20) NOT NULL,
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'contrato', \`title\` VARCHAR(500) NOT NULL DEFAULT '', \`content\` TEXT NULL,
      \`ref_id\` VARCHAR(64) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cwd_org\` (\`organization_id\`), INDEX \`idx_cwd_contract\` (\`contract_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_addenda\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`contract_id\` VARCHAR(20) NOT NULL,
      \`addendum_type\` VARCHAR(20) NOT NULL DEFAULT 'prazo', \`sequence\` INT NOT NULL DEFAULT 1, \`justification\` TEXT NULL,
      \`new_value\` DECIMAL(15,2) NOT NULL DEFAULT 0, \`new_term\` VARCHAR(255) NOT NULL DEFAULT '',
      \`status\` VARCHAR(30) NOT NULL DEFAULT 'solicitado', \`document_reference\` VARCHAR(500) NOT NULL DEFAULT '',
      \`legal_opinion_request_id\` VARCHAR(20) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cad_org\` (\`organization_id\`), INDEX \`idx_cad_contract\` (\`contract_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_ws_apostilles\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`contract_id\` VARCHAR(20) NOT NULL,
      \`kind\` VARCHAR(20) NOT NULL DEFAULT 'reajuste', \`sequence\` INT NOT NULL DEFAULT 1, \`description\` TEXT NULL,
      \`new_value\` DECIMAL(15,2) NOT NULL DEFAULT 0, \`new_manager\` VARCHAR(255) NOT NULL DEFAULT '', \`new_inspector\` VARCHAR(255) NOT NULL DEFAULT '',
      \`document_reference\` VARCHAR(500) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cap_org\` (\`organization_id\`), INDEX \`idx_cap_contract\` (\`contract_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_occurrences\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`contract_id\` VARCHAR(20) NOT NULL,
      \`description\` TEXT NULL, \`occurred_on\` VARCHAR(40) NOT NULL DEFAULT '', \`attachments\` TEXT NULL, \`notes\` TEXT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cocc_org\` (\`organization_id\`), INDEX \`idx_cocc_contract\` (\`contract_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`imported_contracts\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`contract_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`source\` VARCHAR(10) NOT NULL DEFAULT 'pdf', \`raw_text_hash\` VARCHAR(64) NOT NULL DEFAULT '', \`extracted\` TEXT NULL,
      \`confidence\` DECIMAL(5,2) NOT NULL DEFAULT 0, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_imp_org\` (\`organization_id\`), INDEX \`idx_imp_contract\` (\`contract_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`contract_templates\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`name\` VARCHAR(255) NOT NULL DEFAULT '',
      \`kind\` VARCHAR(30) NOT NULL DEFAULT 'contrato', \`body\` TEXT NULL, \`active\` INT NOT NULL DEFAULT 1,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_ctpl_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // FASE 5 — Business Domain 5: Centro de Operações do Departamento
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`operation_records\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`record_type\` VARCHAR(40) NOT NULL DEFAULT 'outro', \`origin\` VARCHAR(10) NOT NULL DEFAULT 'externa',
      \`number\` VARCHAR(80) NOT NULL DEFAULT '', \`object\` TEXT NULL, \`modality\` VARCHAR(60) NOT NULL DEFAULT '',
      \`current_stage\` VARCHAR(60) NOT NULL DEFAULT '', \`responsible\` INT NULL,
      \`reference_type\` VARCHAR(40) NOT NULL DEFAULT '', \`reference_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`document_references\` TEXT NULL, \`notes\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_oprec_org\` (\`organization_id\`), INDEX \`idx_oprec_type\` (\`organization_id\`, \`record_type\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`operational_events\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'manual', \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`event_date\` VARCHAR(10) NOT NULL DEFAULT '', \`event_time\` VARCHAR(5) NOT NULL DEFAULT '',
      \`reference_type\` VARCHAR(40) NOT NULL DEFAULT '', \`reference_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`auto_generated\` INT NOT NULL DEFAULT 0, \`alert_offset_days\` INT NOT NULL DEFAULT 0,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_opevt_org\` (\`organization_id\`), INDEX \`idx_opevt_date\` (\`organization_id\`, \`event_date\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`operational_milestones\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`reference_type\` VARCHAR(40) NOT NULL DEFAULT '', \`reference_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`milestone_type\` VARCHAR(30) NOT NULL DEFAULT 'outro', \`date\` VARCHAR(10) NOT NULL DEFAULT '', \`time\` VARCHAR(5) NOT NULL DEFAULT '',
      \`result\` VARCHAR(255) NOT NULL DEFAULT '', \`observation\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_opms_org\` (\`organization_id\`), INDEX \`idx_opms_ref\` (\`reference_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`operational_timeline\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`event_order\` INT NOT NULL DEFAULT 0,
      \`actor\` VARCHAR(60) NOT NULL DEFAULT '', \`action\` VARCHAR(60) NOT NULL DEFAULT '',
      \`reference_type\` VARCHAR(40) NOT NULL DEFAULT '', \`reference_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`summary\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_optl_org\` (\`organization_id\`), INDEX \`idx_optl_org_order\` (\`organization_id\`, \`event_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`publication_records\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`reference_type\` VARCHAR(40) NOT NULL DEFAULT '', \`reference_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`channel\` VARCHAR(30) NOT NULL DEFAULT 'pncp', \`status\` VARCHAR(20) NOT NULL DEFAULT 'nao_iniciado', \`date\` VARCHAR(10) NOT NULL DEFAULT '',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_oppub_org\` (\`organization_id\`), INDEX \`idx_oppub_ref\` (\`reference_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`operational_settings\` (
      \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
      \`orgao_oficial_name\` VARCHAR(255) NOT NULL DEFAULT 'Órgão Oficial do Município',
      \`jornal_name\` VARCHAR(255) NOT NULL DEFAULT 'Jornal de Grande Circulação',
      \`portal_name\` VARCHAR(255) NOT NULL DEFAULT 'Portal Eletrônico',
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_opset_org\` (\`organization_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // RC-3 — Official Document Engine (pipeline único de documentos oficiais)
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`official_documents\` (
      \`id\` VARCHAR(20) NOT NULL, \`tenant_id\` INT NOT NULL,
      \`business_domain\` VARCHAR(40) NOT NULL DEFAULT '', \`document_type\` VARCHAR(40) NOT NULL DEFAULT 'outro',
      \`origin\` VARCHAR(64) NOT NULL DEFAULT '', \`title\` VARCHAR(500) NOT NULL DEFAULT '',
      \`version\` INT NOT NULL DEFAULT 1, \`status\` VARCHAR(20) NOT NULL DEFAULT 'gerado', \`template\` VARCHAR(120) NOT NULL DEFAULT '',
      \`content\` LONGTEXT NULL, \`metadata\` TEXT NULL, \`author\` VARCHAR(60) NOT NULL DEFAULT '',
      \`lineage_id\` VARCHAR(20) NOT NULL DEFAULT '', \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '', \`replay_hash\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_odoc_tenant\` (\`tenant_id\`),
      INDEX \`idx_odoc_lineage\` (\`tenant_id\`, \`lineage_id\`), INDEX \`idx_odoc_domain\` (\`tenant_id\`, \`business_domain\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.execute(`CREATE TABLE IF NOT EXISTS \`official_document_timeline\` (
      \`id\` VARCHAR(20) NOT NULL, \`tenant_id\` INT NOT NULL,
      \`lineage_id\` VARCHAR(20) NOT NULL DEFAULT '', \`document_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`event_order\` INT NOT NULL DEFAULT 0, \`event_type\` VARCHAR(40) NOT NULL DEFAULT '', \`actor\` VARCHAR(60) NOT NULL DEFAULT '',
      \`summary\` TEXT NULL, \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
      \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_odtl_tenant\` (\`tenant_id\`), INDEX \`idx_odtl_lineage\` (\`lineage_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // RC-3.5 — referências de storage no OfficialDocument (nunca binários no banco).
    await addColumnIfMissing("official_documents", "storage_key",  "VARCHAR(255) NOT NULL DEFAULT ''");
    await addColumnIfMissing("official_documents", "mime_type",    "VARCHAR(120) NOT NULL DEFAULT ''");
    await addColumnIfMissing("official_documents", "size_bytes",   "INT NOT NULL DEFAULT 0");
    await addColumnIfMissing("official_documents", "content_hash", "VARCHAR(64) NOT NULL DEFAULT ''");

    // RC-4.2.1 — Cognitive Observability persistente (recuperável por correlationId).
    await connection.execute(`CREATE TABLE IF NOT EXISTS \`cognitive_observability\` (
      \`id\` VARCHAR(20) NOT NULL, \`tenant_id\` INT NOT NULL,
      \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '', \`task\` VARCHAR(40) NOT NULL DEFAULT '',
      \`replay_hash\` VARCHAR(64) NOT NULL DEFAULT '', \`reasoning_plan_id\` VARCHAR(20) NOT NULL DEFAULT '',
      \`reasoning_plan_hash\` VARCHAR(64) NOT NULL DEFAULT '', \`provider\` VARCHAR(40) NOT NULL DEFAULT '',
      \`latency_ms\` INT NOT NULL DEFAULT 0, \`total_tokens\` INT NOT NULL DEFAULT 0,
      \`structured_output_valid\` TINYINT NOT NULL DEFAULT 1, \`execution_status\` VARCHAR(20) NOT NULL DEFAULT 'completed',
      \`payload\` LONGTEXT NULL, \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`), INDEX \`idx_cobs_corr\` (\`correlation_id\`), INDEX \`idx_cobs_tenant\` (\`tenant_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // RC-5.1 (correção) — "Tirar Dúvidas": persistência institucional das consultas + fontes.
  await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_consultations\` (
    \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`user_id\` INT NOT NULL,
    \`question\` TEXT, \`normalized_question\` TEXT, \`answer\` LONGTEXT,
    \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending', \`limitation_reason\` VARCHAR(500) NOT NULL DEFAULT '',
    \`context_package_version\` VARCHAR(40) NOT NULL DEFAULT '', \`context_replay_hash\` VARCHAR(64) NOT NULL DEFAULT '',
    \`execution_id\` VARCHAR(40) NOT NULL DEFAULT '', \`answer_id\` VARCHAR(40) NOT NULL DEFAULT '',
    \`replay_id\` VARCHAR(40), \`replay_of_execution_id\` VARCHAR(40),
    \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '', \`business_domain\` VARCHAR(60) NOT NULL DEFAULT '',
    \`task_type\` VARCHAR(40) NOT NULL DEFAULT '', \`documents_count\` INT NOT NULL DEFAULT 0,
    \`passages_count\` INT NOT NULL DEFAULT 0, \`retrieval_duration_ms\` INT NOT NULL DEFAULT 0,
    \`execution_duration_ms\` INT NOT NULL DEFAULT 0, \`total_duration_ms\` INT NOT NULL DEFAULT 0,
    \`context_snapshot\` LONGTEXT, \`error_code\` VARCHAR(60) NOT NULL DEFAULT '', \`error_message\` VARCHAR(1000) NOT NULL DEFAULT '',
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`started_at\` DATETIME(3),
    \`completed_at\` DATETIME(3), \`failed_at\` DATETIME(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`), INDEX \`idx_icons_org\` (\`organization_id\`),
    INDEX \`idx_icons_org_created\` (\`organization_id\`, \`created_at\`),
    INDEX \`idx_icons_org_user_created\` (\`organization_id\`, \`user_id\`, \`created_at\`),
    INDEX \`idx_icons_org_ctxhash\` (\`organization_id\`, \`context_replay_hash\`),
    INDEX \`idx_icons_corr\` (\`correlation_id\`), INDEX \`idx_icons_exec\` (\`execution_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_consultation_sources\` (
    \`id\` VARCHAR(32) NOT NULL, \`organization_id\` INT NOT NULL, \`consultation_id\` VARCHAR(20) NOT NULL,
    \`document_id\` VARCHAR(40) NOT NULL DEFAULT '', \`document_version\` VARCHAR(20) NOT NULL DEFAULT '',
    \`document_title\` VARCHAR(500) NOT NULL DEFAULT '', \`document_type\` VARCHAR(40) NOT NULL DEFAULT '',
    \`authority\` VARCHAR(160) NOT NULL DEFAULT '', \`jurisdiction\` VARCHAR(20) NOT NULL DEFAULT '',
    \`binding_level\` VARCHAR(40) NOT NULL DEFAULT '', \`citation\` VARCHAR(1000) NOT NULL DEFAULT '',
    \`passage\` TEXT, \`lineage\` VARCHAR(64) NOT NULL DEFAULT '', \`source_order\` INT NOT NULL DEFAULT 0,
    \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (\`id\`), INDEX \`idx_icsrc_org\` (\`organization_id\`),
    INDEX \`idx_icsrc_org_consultation\` (\`organization_id\`, \`consultation_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // ── Reconciliação de schema (auditoria × produção criada por db:push antigo) ──
  // A auditoria (scripts/schema-audit.ts) apontou 54 colunas declaradas no Drizzle e AUSENTES
  // em tabelas que JÁ EXISTEM no banco (criadas por db:push antigo, antes dessas colunas).
  // O journal marca as migrations como aplicadas, então o migrate() nunca as adiciona.
  // Definições extraídas do schema.ts atual via drizzle-kit (tipos exatos). Idempotente:
  // addColumnIfMissing só age se a tabela existir e a coluna faltar. As TABELAS ausentes
  // são criadas pela migration 0285_schema_reconciliation.

  await addColumnIfMissing("clause_knowledge",        "purpose",                "text");
  await addColumnIfMissing("clause_knowledge",        "related_document_types", "text");
  await addColumnIfMissing("clause_knowledge",        "prerequisites",          "text");
  await addColumnIfMissing("clause_knowledge",        "active",                 "tinyint NOT NULL DEFAULT 1");
  await addColumnIfMissing("clause_knowledge",        "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("context_assemblies",      "query_id",               "varchar(20) NOT NULL DEFAULT ''");
  await addColumnIfMissing("context_assemblies",      "retrieved_chunks",       "json");
  await addColumnIfMissing("context_assemblies",      "legal_references",       "json");
  await addColumnIfMissing("context_assemblies",      "municipality_history",   "json");
  await addColumnIfMissing("context_assemblies",      "similar_trs",            "json");
  await addColumnIfMissing("context_assemblies",      "semantic_evidence",      "json");
  await addColumnIfMissing("context_assemblies",      "prompt_context",         "text");
  await addColumnIfMissing("context_assemblies",      "total_tokens",           "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("context_assemblies",      "assembly_strategy",      "varchar(50) NOT NULL DEFAULT 'selective'");
  await addColumnIfMissing("context_assemblies",      "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("entity_resolutions",      "confidence",             "decimal(5,4) NOT NULL DEFAULT '0.5'");
  await addColumnIfMissing("entity_resolutions",      "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("extraction_evidence",     "provenanceSheet",        "varchar(128)");
  await addColumnIfMissing("extraction_evidence",     "provenancePage",         "int");
  await addColumnIfMissing("extraction_evidence",     "provenanceRow",          "int");
  await addColumnIfMissing("extraction_evidence",     "provenanceCol",          "varchar(32)");

  await addColumnIfMissing("graph_change_log",        "changed_by",             "varchar(255) NOT NULL DEFAULT 'system'");
  await addColumnIfMissing("graph_change_log",        "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("graph_change_log",        "created_at",             "datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");

  await addColumnIfMissing("graph_metrics",           "metric_unit",            "varchar(50) NOT NULL DEFAULT 'count'");
  await addColumnIfMissing("graph_metrics",           "created_at",             "datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)");

  await addColumnIfMissing("graph_versions",          "change_summary",         "text");
  await addColumnIfMissing("graph_versions",          "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("legal_reference_nodes",   "numero",                 "varchar(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing("legal_reference_nodes",   "ano",                    "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("legal_reference_nodes",   "orgao",                  "varchar(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing("legal_reference_nodes",   "artigo",                 "varchar(100)");
  await addColumnIfMissing("legal_reference_nodes",   "alinea",                 "varchar(100)");
  await addColumnIfMissing("legal_reference_nodes",   "texto",                  "text");
  await addColumnIfMissing("legal_reference_nodes",   "vigencia",               "varchar(50) NOT NULL DEFAULT 'vigente'");
  await addColumnIfMissing("legal_reference_nodes",   "ementa",                 "text");
  await addColumnIfMissing("legal_reference_nodes",   "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("ontology_taxonomy",       "category",               "varchar(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing("ontology_taxonomy",       "definition",             "text");
  await addColumnIfMissing("ontology_taxonomy",       "legal_basis",            "varchar(500) NOT NULL DEFAULT ''");
  await addColumnIfMissing("ontology_taxonomy",       "aliases",                "text");
  await addColumnIfMissing("ontology_taxonomy",       "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("process_members",         "functionalRole",         "enum('solicitante','compras','juridico','controle_interno','gestor','fiscal','administrador')");

  await addColumnIfMissing("procurement_concepts",    "parent_concept_id",      "varchar(20)");
  await addColumnIfMissing("procurement_concepts",    "examples",               "text");
  await addColumnIfMissing("procurement_concepts",    "correlation_id",         "varchar(64) NOT NULL DEFAULT ''");

  await addColumnIfMissing("semantic_candidates",     "explanationPenalty",     "decimal(4,3) DEFAULT '0'");
  await addColumnIfMissing("semantic_candidates",     "explanationBonus",       "decimal(4,3) DEFAULT '0'");
  await addColumnIfMissing("semantic_candidates",     "catmatDesc",             "text");
  await addColumnIfMissing("semantic_candidates",     "catmatGroup",            "varchar(128)");

  await addColumnIfMissing("semantic_search_entries", "subcategory",            "varchar(128)");
  await addColumnIfMissing("semantic_search_entries", "lastSeenAt",             "timestamp");
  await addColumnIfMissing("semantic_search_entries", "catmatGroup",            "varchar(128)");
  await addColumnIfMissing("semantic_search_entries", "catmatClass",            "varchar(128)");

  // ── Convergência de bancos criados PELA CADEIA de migrations (staging/CI zerados) ──
  // Nessas tabelas as migrations antigas criaram colunas em snake_case, mas o schema.ts
  // (alinhado à PRODUÇÃO pela #170) declara camelCase. Renomeia banco→schema APENAS quando
  // o nome antigo existe e o novo falta — em produção (nomes já corretos) é no-op.
  // RENAME COLUMN (MySQL 8) preserva dados, tipo e índices. Lista gerada do relatório da
  // auditoria (formato: nomeNoSchema → nomeNoBanco; aqui invertido: from=banco, to=schema).
  async function renameColumnIfNeeded(table: string, from: string, to: string): Promise<void> {
    const [fromRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, from]
    );
    if ((fromRows[0] as ColRow).cnt === 0) return;
    const [toRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, to]
    );
    if ((toRows[0] as ColRow).cnt > 0) return;
    await connection.execute(`ALTER TABLE \`${table}\` RENAME COLUMN \`${from}\` TO \`${to}\``);
    log("DB", `✓ Schema corrigido: ${table}.${from} → ${to}`);
  }

  const CHAIN_RENAMES: Array<[string, string, string]> = [
    ["department_permissions", "created_at", "createdAt"],
    ["environments", "created_at", "createdAt"],
    ["environments", "updated_at", "updatedAt"],
    ["extraction_evidence", "staging_item_id", "stagingItemId"],
    ["extraction_evidence", "import_session_id", "importSessionId"],
    ["extraction_evidence", "organization_id", "organizationId"],
    ["extraction_evidence", "created_at", "createdAt"],
    ["extraction_evidence", "updated_at", "updatedAt"],
    ["import_analytics_snapshots", "organization_id", "organizationId"],
    ["import_analytics_snapshots", "period_start", "periodStart"],
    ["import_analytics_snapshots", "period_end", "periodEnd"],
    ["import_analytics_snapshots", "session_count", "sessionCount"],
    ["import_analytics_snapshots", "item_count", "itemCount"],
    ["import_analytics_snapshots", "created_at", "createdAt"],
    ["import_review_transitions", "staging_item_id", "stagingItemId"],
    ["import_review_transitions", "from_state", "fromState"],
    ["import_review_transitions", "to_state", "toState"],
    ["import_review_transitions", "actor_type", "actorType"],
    ["import_review_transitions", "actor_user_id", "actorUserId"],
    ["import_review_transitions", "actor_org_id", "actorOrgId"],
    ["import_review_transitions", "actor_agent_id", "actorAgentId"],
    ["import_review_transitions", "occurred_at", "occurredAt"],
    ["operational_feedback", "created_at", "createdAt"],
    ["operational_health_snapshots", "created_at", "createdAt"],
    ["operational_templates", "created_at", "createdAt"],
    ["operational_templates", "updated_at", "updatedAt"],
    ["parser_capabilities", "parser_type", "parserType"],
    ["parser_capabilities", "parser_version", "parserVersion"],
    ["parser_capabilities", "supports_multi_sheet", "supportsMultiSheet"],
    ["parser_capabilities", "supports_multi_page", "supportsMultiPage"],
    ["parser_capabilities", "supports_formulas", "supportsFormulas"],
    ["parser_capabilities", "supports_merged_cells", "supportsMergedCells"],
    ["parser_capabilities", "supports_images", "supportsImages"],
    ["parser_capabilities", "supports_headers", "supportsHeaders"],
    ["parser_capabilities", "supports_footers", "supportsFooters"],
    ["parser_capabilities", "description_confidence", "descriptionConfidence"],
    ["parser_capabilities", "quantity_confidence", "quantityConfidence"],
    ["parser_capabilities", "unit_confidence", "unitConfidence"],
    ["parser_capabilities", "price_confidence", "priceConfidence"],
    ["parser_capabilities", "requires_manual_unit_review", "requiresManualUnitReview"],
    ["parser_capabilities", "requires_manual_price_review", "requiresManualPriceReview"],
    ["parser_capabilities", "likelihood_merged_headers", "likelihoodMergedHeaders"],
    ["parser_capabilities", "likelihood_footer_rows", "likelihoodFooterRows"],
    ["parser_capabilities", "registered_at", "registeredAt"],
    ["pilot_execution_snapshots", "created_at", "createdAt"],
    ["pilot_execution_snapshots", "updated_at", "updatedAt"],
    ["pilot_organizations", "created_at", "createdAt"],
    ["pilot_organizations", "updated_at", "updatedAt"],
    ["pilot_readiness_scores", "created_at", "createdAt"],
    ["semantic_candidates", "staging_item_id", "stagingItemId"],
    ["semantic_candidates", "import_session_id", "importSessionId"],
    ["semantic_candidates", "organization_id", "organizationId"],
    ["semantic_candidates", "proposed_description", "proposedDescription"],
    ["semantic_candidates", "proposed_unit", "proposedUnit"],
    ["semantic_candidates", "proposed_quantity", "proposedQuantity"],
    ["semantic_candidates", "proposed_unit_price", "proposedUnitPrice"],
    ["semantic_candidates", "explanation_reason", "explanationReason"],
    ["semantic_candidates", "explanation_matched", "explanationMatched"],
    ["semantic_candidates", "original_raw", "originalRaw"],
    ["semantic_candidates", "catmat_code", "catmatCode"],
    ["semantic_candidates", "index_entry_id", "indexEntryId"],
    ["semantic_candidates", "generated_at", "generatedAt"],
    ["semantic_candidates", "evaluated_at", "evaluatedAt"],
    ["semantic_candidates", "evaluated_by", "evaluatedBy"],
    ["semantic_search_entries", "organization_id", "organizationId"],
    ["semantic_search_entries", "canonical_text", "canonicalText"],
    ["semantic_search_entries", "display_text", "displayText"],
    ["semantic_search_entries", "synonym_tokens", "synonymTokens"],
    ["semantic_search_entries", "catmat_code", "catmatCode"],
    ["semantic_search_entries", "is_active", "isActive"],
    ["semantic_search_entries", "created_at", "createdAt"],
    ["semantic_search_entries", "updated_at", "updatedAt"],
    ["support_incidents", "created_at", "createdAt"],
    ["support_incidents", "updated_at", "updatedAt"],
    ["training_analytics", "created_at", "createdAt"],
    ["ux_events", "created_at", "createdAt"],
    ["workflow_analytics_snapshots", "created_at", "createdAt"],
    ["workflow_permissions", "created_at", "createdAt"],
    ["workload_metrics", "created_at", "createdAt"],
  ];
  for (const [table, from, to] of CHAIN_RENAMES) {
    await renameColumnIfNeeded(table, from, to);
  }

  // semantic_chunks: a re-fundação (0183) tem menos colunas que a forma final do schema.ts
  // (evoluída depois via db:push na produção). Completa o que faltar — idempotente.
  await addColumnIfMissing("semantic_chunks", "document_type",     "varchar(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing("semantic_chunks", "content",           "text");
  await addColumnIfMissing("semantic_chunks", "total_chunks",      "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("semantic_chunks", "strategy",          "varchar(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing("semantic_chunks", "section_title",     "varchar(255)");
  await addColumnIfMissing("semantic_chunks", "legal_ref",         "varchar(255)");
  await addColumnIfMissing("semantic_chunks", "overlap_with_prev", "int NOT NULL DEFAULT 0");
  await addColumnIfMissing("semantic_chunks", "lineage",           "json");
  await addColumnIfMissing("semantic_chunks", "replay_key",        "varchar(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("semantic_chunks", "metadata",          "json");

  // ── knowledge_nodes / knowledge_edges: forma camelCase antiga (db:push de outra era) ──
  // Encontrado no STAGING: essas duas tabelas existem lá na forma camelCase antiga, mas o
  // schema.ts (alinhado à PRODUÇÃO pela #170) usa snake_case neste grupo — o "grupo inverso"
  // já documentado na #168 (graph/ontologia/clause/entity). Na produção e em bancos criados
  // pela cadeia os nomes já estão corretos → tudo aqui é no-op nesses ambientes.
  await renameColumnIfNeeded("knowledge_edges", "organizationId",   "organization_id");
  await renameColumnIfNeeded("knowledge_edges", "relationshipType", "relationship_type");
  await renameColumnIfNeeded("knowledge_edges", "createdAt",        "created_at");
  await renameColumnIfNeeded("knowledge_nodes", "organizationId",   "organization_id");
  await renameColumnIfNeeded("knowledge_nodes", "nodeType",         "node_type");
  await renameColumnIfNeeded("knowledge_nodes", "normalizedTitle",  "normalized_title");
  await renameColumnIfNeeded("knowledge_nodes", "createdAt",        "created_at");

  await addColumnIfMissing("knowledge_edges", "source_node_id", "varchar(20) NOT NULL DEFAULT ''");
  await addColumnIfMissing("knowledge_edges", "target_node_id", "varchar(20) NOT NULL DEFAULT ''");
  await addColumnIfMissing("knowledge_edges", "weight",         "decimal(5,4) NOT NULL DEFAULT '1.0'");
  await addColumnIfMissing("knowledge_edges", "confidence",     "decimal(5,4) NOT NULL DEFAULT '1.0'");
  await addColumnIfMissing("knowledge_edges", "justification",  "text");
  await addColumnIfMissing("knowledge_edges", "provenance",     "varchar(100) NOT NULL DEFAULT 'manual'");
  await addColumnIfMissing("knowledge_edges", "active",         "tinyint NOT NULL DEFAULT 1");
  await addColumnIfMissing("knowledge_edges", "correlation_id", "varchar(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing("knowledge_nodes", "external_id",    "varchar(255)");
  await addColumnIfMissing("knowledge_nodes", "confidence",     "decimal(5,4) NOT NULL DEFAULT '1.0'");
  await addColumnIfMissing("knowledge_nodes", "source",         "varchar(100) NOT NULL DEFAULT 'manual'");
  await addColumnIfMissing("knowledge_nodes", "active",         "tinyint NOT NULL DEFAULT 1");
  await addColumnIfMissing("knowledge_nodes", "correlation_id", "varchar(64) NOT NULL DEFAULT ''");

  // Contrato avulso (0286) — usuário responsável pela criação do workspace.
  await addColumnIfMissing("contract_workspaces", "created_by", "int");

  // PR A.1 (0287) — Acesso institucional: convites, recuperação de senha e outbox de e-mail.
  // Rede de segurança para ambientes cujo journal já marca migrations como aplicadas.
  await connection.execute(`CREATE TABLE IF NOT EXISTS \`institutional_invitations\` (
    \`id\` INT AUTO_INCREMENT NOT NULL,
    \`organizationId\` INT NOT NULL,
    \`emailNormalized\` VARCHAR(320) NOT NULL,
    \`role\` ENUM('owner','admin','manager','operator','viewer') NOT NULL DEFAULT 'operator',
    \`status\` ENUM('pending','accepted','expired','cancelled','superseded') NOT NULL DEFAULT 'pending',
    \`tokenHash\` VARCHAR(64) NOT NULL,
    \`activeKey\` VARCHAR(350) NULL,
    \`invitedName\` VARCHAR(255) NULL,
    \`expiresAt\` TIMESTAMP NOT NULL,
    \`acceptedAt\` TIMESTAMP NULL, \`cancelledAt\` TIMESTAMP NULL,
    \`createdByUserId\` INT NULL, \`acceptedByUserId\` INT NULL,
    \`resendCount\` INT NOT NULL DEFAULT 0, \`lastSentAt\` TIMESTAMP NULL,
    \`correlationId\` VARCHAR(36) NULL,
    \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`institutional_invitations_active_key\` (\`activeKey\`),
    UNIQUE KEY \`institutional_invitations_token_hash\` (\`tokenHash\`),
    INDEX \`idx_invitations_org_status\` (\`organizationId\`, \`status\`),
    INDEX \`idx_invitations_expires\` (\`status\`, \`expiresAt\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS \`password_reset_tokens\` (
    \`id\` INT AUTO_INCREMENT NOT NULL,
    \`userId\` INT NOT NULL,
    \`tokenHash\` VARCHAR(64) NOT NULL,
    \`expiresAt\` TIMESTAMP NOT NULL,
    \`consumedAt\` TIMESTAMP NULL, \`revokedAt\` TIMESTAMP NULL,
    \`requestedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`ipAddress\` VARCHAR(45) NULL, \`correlationId\` VARCHAR(36) NULL,
    \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`password_reset_tokens_token_hash\` (\`tokenHash\`),
    INDEX \`idx_password_reset_user\` (\`userId\`, \`expiresAt\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await connection.execute(`CREATE TABLE IF NOT EXISTS \`email_outbox\` (
    \`id\` INT AUTO_INCREMENT NOT NULL,
    \`organizationId\` INT NULL,
    \`messageType\` VARCHAR(60) NOT NULL,
    \`recipient\` VARCHAR(320) NOT NULL,
    \`templateKey\` VARCHAR(60) NOT NULL,
    \`payload\` JSON NOT NULL,
    \`idempotencyKey\` VARCHAR(190) NOT NULL,
    \`status\` ENUM('pending','processing','sent','retryable_failure','permanent_failure','cancelled') NOT NULL DEFAULT 'pending',
    \`provider\` VARCHAR(40) NULL, \`providerMessageId\` VARCHAR(255) NULL,
    \`attempts\` INT NOT NULL DEFAULT 0, \`maxAttempts\` INT NOT NULL DEFAULT 5,
    \`nextAttemptAt\` TIMESTAMP NULL, \`sentAt\` TIMESTAMP NULL, \`failedAt\` TIMESTAMP NULL,
    \`lastErrorCode\` VARCHAR(60) NULL, \`lastErrorMessage\` VARCHAR(500) NULL,
    \`correlationId\` VARCHAR(36) NULL,
    \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`email_outbox_idempotency_key\` (\`idempotencyKey\`),
    INDEX \`idx_email_outbox_dispatch\` (\`status\`, \`nextAttemptAt\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
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
    await runMigrations(connection);
    await ensureSchema(connection);
    await seedAdmin(connection);
    await seedDefaultOrgMembership(connection);
  } finally {
    await connection.end();
  }

  log("OK", "Bootstrap concluído. Servidor pronto.");
}
