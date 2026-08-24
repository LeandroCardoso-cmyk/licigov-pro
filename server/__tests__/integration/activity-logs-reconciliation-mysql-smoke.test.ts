/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.3A-OPS.2 — Reconciliação de `activity_logs.processId` contra MySQL REAL (CI). Executável.
 *
 * O CI só testava BANCO NOVO (cadeia completa → 0041 roda → processId já nullable), por isso não
 * capturou o drift de bancos db:push baseline-stampados (0041 pulada → processId NOT NULL). Este smoke
 * reproduz o caminho histórico REAL e prova a correção pela migration FORMAL drizzle/0294:
 *   - banco novo → processId já nullable (PASS);
 *   - banco legado (processId NOT NULL) → o INSERT de auditoria governada FALHA e derruba o override
 *     por rollback (comprova a causa);
 *   - aplicar 0294 → processId nullable, preservando linhas históricas;
 *   - após reconciliar → setTenantFlag persiste override + auditoria org-level (processId NULL)
 *     atomicamente; replay não duplica;
 *   - 2ª aplicação de 0294 → idempotente (NO-OP).
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { setTenantFlag, resolveTenantFlag } from "../../services/featureFlagAdminService";
import { FF_DIRECT_CONTRACT_SHADOW } from "../../services/directContractShadowService";
import { invalidateAllFlagsForTenant } from "../../services/featureFlagService";

const DB = process.env.DATABASE_URL;
const ORG = 960701;
const ACTOR = 55501;
// expiry FIXO reutilizado entre enable e replay — o payloadHash inclui expiresAt, então o replay
// precisa do MESMO valor (um novo Date por chamada mudaria o hash → CONFLICT em vez de replay).
const EXPIRES = new Date(Date.now() + 3_600_000);
const MIGRATION = resolve(__dirname, "../../../drizzle/0294_activity_logs_governance_reconciliation.sql");

let conn: mysql.Connection;

async function processIdIsNullable(): Promise<boolean> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_logs' AND COLUMN_NAME = 'processId'`,
  );
  return String((rows[0] as any).IS_NULLABLE).toUpperCase() === "YES";
}

/** Aplica a migration FORMAL 0294 (o artefato real), chunk a chunk, como o migrator faria. */
async function applyReconciliation(): Promise<void> {
  const raw = readFileSync(MIGRATION, "utf8");
  for (const rawChunk of raw.split("--> statement-breakpoint")) {
    const sql = rawChunk
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (sql) await conn.query(sql);
  }
}

async function countFlagAudit(): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag'",
    [ORG],
  );
  return Number((rows[0] as any).n);
}

describe.skipIf(!DB)("C.3A-OPS.2 — Reconciliação de activity_logs.processId (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "Recon Org", "recon-activitylogs"]).catch(() => {});
    await conn.execute("DELETE FROM tenant_feature_flags WHERE organizationId = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]).catch(() => {});
    invalidateAllFlagsForTenant(ORG);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM tenant_feature_flags WHERE organizationId = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM activity_logs WHERE organizationId = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("banco novo: cadeia completa deixa processId nullable (PASS)", async () => {
    expect(await processIdIsNullable()).toBe(true);
  });

  it("banco legado (drift): processId NOT NULL faz o INSERT de auditoria governada falhar (rollback do override)", async () => {
    // Simula o estado db:push baseline-stampado onde a 0041 foi pulada.
    await conn.execute("DELETE FROM activity_logs"); // MODIFY NOT NULL exige zero linhas com NULL
    await conn.execute("ALTER TABLE `activity_logs` MODIFY `processId` int NOT NULL");
    // Linha histórica com processId setado — para provar preservação após a reconciliação.
    await conn.execute(
      "INSERT INTO activity_logs (organizationId, processId, userId, action, sourceContext) VALUES (?, ?, ?, ?, 'system')",
      [ORG, 777, ACTOR, "historical_legacy_row"],
    );
    expect(await processIdIsNullable()).toBe(false);

    let threw = false;
    try {
      await setTenantFlag({
        organizationId: ORG,
        flagName: FF_DIRECT_CONTRACT_SHADOW,
        enabled: true,
        reason: "tentativa sob drift",
        expiresAt: new Date(Date.now() + 3600_000),
        idempotencyKey: "recon-drift-attempt",
        actorUserId: ACTOR,
        correlationId: "corr-recon-drift",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // o INSERT de auditoria (processId NULL) falha sob a coluna NOT NULL
    // Atomicidade: o override sofreu rollback junto — nada persistido.
    invalidateAllFlagsForTenant(ORG);
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG);
    expect(view.override).toBeNull();
    expect(view.effectiveValue).toBe(false);
  }, 60_000);

  it("aplicar 0294 torna processId nullable e PRESERVA linhas históricas", async () => {
    await applyReconciliation();
    expect(await processIdIsNullable()).toBe(true);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT processId, action FROM activity_logs WHERE organizationId = ? AND action = 'historical_legacy_row'",
      [ORG],
    );
    expect(rows.length).toBe(1);
    expect(Number((rows[0] as any).processId)).toBe(777); // valor histórico intacto
  }, 60_000);

  it("após reconciliar: setTenantFlag persiste override + auditoria org-level (processId NULL) atomicamente", async () => {
    invalidateAllFlagsForTenant(ORG);
    const auditBefore = await countFlagAudit();
    const r = await setTenantFlag({
      organizationId: ORG,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      reason: "homologação após reconciliação",
      expiresAt: EXPIRES,
      idempotencyKey: "recon-enable",
      actorUserId: ACTOR,
      correlationId: "corr-recon-enable",
    });
    expect(r.after.enabled).toBe(true);

    // Override persistido.
    invalidateAllFlagsForTenant(ORG);
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG);
    expect(view.override?.enabled).toBe(true);
    expect(view.origin).toBe("tenant");

    // Auditoria org-level com processId NULL persistida (exatamente 1 nova linha, atômica).
    expect(await countFlagAudit()).toBe(auditBefore + 1);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT processId, userId, entityType FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag' ORDER BY id DESC LIMIT 1",
      [ORG],
    );
    expect((rows[0] as any).processId).toBeNull();
    expect(Number((rows[0] as any).userId)).toBe(ACTOR);
  }, 60_000);

  it("replay (mesma chave + payload) não duplica auditoria", async () => {
    const before = await countFlagAudit();
    const r = await setTenantFlag({
      organizationId: ORG,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      reason: "homologação após reconciliação",
      expiresAt: EXPIRES,
      idempotencyKey: "recon-enable",
      actorUserId: ACTOR,
      correlationId: "corr-recon-enable",
    });
    expect(r.replayed).toBe(true);
    expect(await countFlagAudit()).toBe(before);
  }, 60_000);

  it("2ª aplicação de 0294 é idempotente (NO-OP, sem erro, processId segue nullable)", async () => {
    await applyReconciliation();
    expect(await processIdIsNullable()).toBe(true);
    // Linha histórica e auditoria continuam intactas.
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM activity_logs WHERE organizationId = ? AND action = 'historical_legacy_row'",
      [ORG],
    );
    expect(Number((rows[0] as any).n)).toBe(1);
  }, 60_000);
});
