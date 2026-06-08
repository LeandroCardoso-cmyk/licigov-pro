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
