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
