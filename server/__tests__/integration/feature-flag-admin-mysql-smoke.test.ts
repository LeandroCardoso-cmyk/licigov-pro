/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.3A-OPS — Controle institucional de feature flags contra MySQL REAL (CI). Executável.
 *
 * Cobre: leitura (sem override → default; com override; expiry), escrita (enable/disable/expiry, com
 * auditoria ATÔMICA e persistida com todos os campos), replay (mesma chave+payload → sem 2ª alteração,
 * sem 2ª linha de auditoria; chave+payload diferente → CONFLICT), invalidação de cache (leitura imediata
 * reflete o novo estado), isolamento multi-tenant (A ≠ B). Só roda com DATABASE_URL.
 *
 * PRODUÇÃO GOVERNADA (IS_PRODUCTION=true): FF_CANONICAL_INGESTION alterável SÓ por tenant (enable/disable,
 * auditoria atômica, replay, isolamento A ≠ B, sem linha global); FF_DIRECT_CONTRACT_SHADOW continua
 * FORBIDDEN sem efeito; falha da auditoria faz rollback do override (nunca flag sem auditoria).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { setTenantFlag, resolveTenantFlag } from "../../services/featureFlagAdminService";
import { FF_DIRECT_CONTRACT_SHADOW } from "../../services/directContractShadowService";
import { isFeatureEnabled, invalidateAllFlagsForTenant } from "../../services/featureFlagService";
import { CANONICAL_INGESTION_FLAG } from "../../services/ingestionUploadService";

const DB = process.env.DATABASE_URL;
const ORG_A = 970501;
const ORG_B = 970502;
const ACTOR = 4242;

let conn: mysql.Connection;

async function countAudit(organizationId: number): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag'",
    [organizationId],
  );
  return Number((rows[0] as any).n);
}

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    await conn.execute("DELETE FROM tenant_feature_flags WHERE organizationId = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag'", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
    invalidateAllFlagsForTenant(org);
  }
}

describe.skipIf(!DB)("C.3A-OPS — Controle de feature flags (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    // Organizações reais (a escrita valida existência do tenant).
    for (const [org, slug] of [[ORG_A, "ffadmin-a"], [ORG_B, "ffadmin-b"]] as const) {
      await conn
        .execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [
          org,
          `FF Admin Org ${org}`,
          slug,
        ])
        .catch(() => {});
    }
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup();
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("leitura sem override → origem default, efetivo false", async () => {
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_A);
    expect(view.origin).toBe("default");
    expect(view.effectiveValue).toBe(false);
    expect(view.override).toBeNull();
  });

  it("escrita (enable) cria override, audita atomicamente e a leitura imediata reflete", async () => {
    const auditBefore = await countAudit(ORG_A);
    const r = await setTenantFlag({
      organizationId: ORG_A,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      reason: "homologação staging C.3A",
      idempotencyKey: "ffadmin-a-enable",
      actorUserId: ACTOR,
      actorName: "Admin Plataforma",
      actorEmail: "admin@plataforma.gov.br",
      actorRole: "admin",
      correlationId: "corr-ffadmin-a-1",
    });
    expect(r.replayed).toBe(false);
    expect(r.after.enabled).toBe(true);
    expect(r.after.percentage).toBe(100);
    expect(r.effectiveValue).toBe(true);
    expect(r.origin).toBe("tenant");

    // Cache invalidado → leitura via serviço de avaliação reflete o novo estado.
    expect(await isFeatureEnabled(FF_DIRECT_CONTRACT_SHADOW, ORG_A)).toBe(true);
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_A);
    expect(view.origin).toBe("tenant");
    expect(view.override?.enabled).toBe(true);

    // Auditoria persistida (exatamente 1 nova linha) com todos os campos exigidos.
    expect(await countAudit(ORG_A)).toBe(auditBefore + 1);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag' ORDER BY id DESC LIMIT 1",
      [ORG_A],
    );
    const audit = rows[0] as any;
    expect(audit.userId).toBe(ACTOR);
    expect(audit.correlationId).toBe("corr-ffadmin-a-1");
    expect(audit.action).toBe("feature_flag_enabled");
    const details = JSON.parse(audit.details);
    expect(details.flagName).toBe(FF_DIRECT_CONTRACT_SHADOW);
    expect(details.reason).toBe("homologação staging C.3A");
    expect(details.idempotencyKey).toBe("ffadmin-a-enable");
    expect(details.before).toBeNull();
    expect(details.after.enabled).toBe(true);
  }, 60_000);

  it("replay (mesma chave + mesmo payload) não altera de novo nem duplica auditoria", async () => {
    const auditBefore = await countAudit(ORG_A);
    const r = await setTenantFlag({
      organizationId: ORG_A,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      reason: "homologação staging C.3A",
      idempotencyKey: "ffadmin-a-enable",
      actorUserId: ACTOR,
      correlationId: "corr-ffadmin-a-1",
    });
    expect(r.replayed).toBe(true);
    expect(await countAudit(ORG_A)).toBe(auditBefore); // sem 2ª linha de auditoria
  }, 60_000);

  it("mesma chave + payload diferente → CONFLICT (nunca sobrescreve sob a mesma chave)", async () => {
    let code: string | undefined;
    try {
      await setTenantFlag({
        organizationId: ORG_A,
        flagName: FF_DIRECT_CONTRACT_SHADOW,
        enabled: false, // payload diferente sob a MESMA chave
        reason: "homologação staging C.3A",
        idempotencyKey: "ffadmin-a-enable",
        actorUserId: ACTOR,
        correlationId: "corr-ffadmin-a-1",
      });
    } catch (err) {
      code = (err as any).code;
    }
    expect(code).toBe("CONFLICT");
  }, 60_000);

  it("escrita (disable) com nova chave desliga e audita", async () => {
    const auditBefore = await countAudit(ORG_A);
    const r = await setTenantFlag({
      organizationId: ORG_A,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: false,
      reason: "encerrando homologação",
      idempotencyKey: "ffadmin-a-disable",
      actorUserId: ACTOR,
      correlationId: "corr-ffadmin-a-2",
    });
    expect(r.replayed).toBe(false);
    expect(r.before?.enabled).toBe(true); // estado anterior capturado
    expect(r.after.enabled).toBe(false);
    expect(r.effectiveValue).toBe(false);
    expect(await isFeatureEnabled(FF_DIRECT_CONTRACT_SHADOW, ORG_A)).toBe(false);
    expect(await countAudit(ORG_A)).toBe(auditBefore + 1);
  }, 60_000);

  it("escrita com expiry futuro: override com expiresAt, efetivo true enquanto não expira", async () => {
    const future = new Date(Date.now() + 3600_000);
    const r = await setTenantFlag({
      organizationId: ORG_A,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      expiresAt: future,
      reason: "janela de homologação",
      idempotencyKey: "ffadmin-a-expiry",
      actorUserId: ACTOR,
      correlationId: "corr-ffadmin-a-3",
    });
    expect(r.after.expiresAt).not.toBeNull();
    expect(r.effectiveValue).toBe(true);
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_A);
    expect(view.origin).toBe("tenant");
    expect(view.override?.expiresAt).not.toBeNull();
  }, 60_000);

  it("expiry passado inserido diretamente → leitura cai para default (não efetivo)", async () => {
    await conn.execute(
      "INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage, expiresAt) VALUES (?, ?, 1, 100, ?) " +
        "ON DUPLICATE KEY UPDATE enabled = 1, expiresAt = VALUES(expiresAt)",
      [ORG_B, FF_DIRECT_CONTRACT_SHADOW, new Date(Date.now() - 3600_000)],
    );
    invalidateAllFlagsForTenant(ORG_B);
    const view = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_B);
    expect(view.override).not.toBeNull(); // override existe (informativo)
    expect(view.effectiveValue).toBe(false); // mas expirado → não efetivo
    expect(view.origin).toBe("default");
  }, 60_000);

  it("isolamento multi-tenant: alterar A não altera B (A ≠ B)", async () => {
    await cleanup();
    // Reinsere orgs após cleanup não remover organizations.
    await setTenantFlag({
      organizationId: ORG_A,
      flagName: FF_DIRECT_CONTRACT_SHADOW,
      enabled: true,
      reason: "somente A",
      idempotencyKey: "ffadmin-iso-a",
      actorUserId: ACTOR,
      correlationId: "corr-iso-a",
    });
    const a = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_A);
    const b = await resolveTenantFlag(FF_DIRECT_CONTRACT_SHADOW, ORG_B);
    expect(a.effectiveValue).toBe(true);
    expect(a.origin).toBe("tenant");
    expect(b.effectiveValue).toBe(false);
    expect(b.origin).toBe("default");
    expect(await countAudit(ORG_B)).toBe(0); // nada auditado sob B
  }, 60_000);

  it("organização inexistente → NOT_FOUND (sem tenant desconhecido)", async () => {
    let code: string | undefined;
    try {
      await setTenantFlag({
        organizationId: 90909090,
        flagName: FF_DIRECT_CONTRACT_SHADOW,
        enabled: true,
        reason: "org fantasma",
        idempotencyKey: "ffadmin-ghost",
        actorUserId: ACTOR,
        correlationId: "corr-ghost",
      });
    } catch (err) {
      code = (err as any).code;
    }
    expect(code).toBe("NOT_FOUND");
  }, 60_000);
});

describe.skipIf(!DB)("Produção governada — FF_CANONICAL_INGESTION por tenant (MySQL real)", () => {
  const ORG_P = 970511;
  const ORG_Q = 970512;
  const REASON = "Piloto — importação de PDF na Pesquisa de Preços";
  let prod: typeof import("../../services/featureFlagAdminService");

  const tenantRow = async (org: number, flag: string) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT enabled FROM tenant_feature_flags WHERE organizationId = ? AND flagName = ?", [org, flag]);
    return rows[0] ? Boolean((rows[0] as any).enabled) : null;
  };
  const audits = async (org: number) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT action, userId, correlationId, requestId, details FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag' ORDER BY id", [org]);
    return rows as any[];
  };
  const effective = async (org: number) => { invalidateAllFlagsForTenant(org); return isFeatureEnabled(CANONICAL_INGESTION_FLAG, org); };
  const write = (org: number, enabled: boolean, key: string, extra: Record<string, unknown> = {}) =>
    prod.setTenantFlag({ organizationId: org, flagName: CANONICAL_INGESTION_FLAG, enabled, reason: REASON, idempotencyKey: key,
      actorUserId: ACTOR, actorName: "Admin Plataforma", actorRole: "admin", correlationId: `corr-${key}`, requestId: `req-${key}`, ...extra });

  async function cleanupProd() {
    for (const org of [ORG_P, ORG_Q]) {
      await conn.execute("DELETE FROM tenant_feature_flags WHERE organizationId = ?", [org]).catch(() => {});
      await conn.execute("DELETE FROM activity_logs WHERE organizationId = ? AND entityType = 'feature_flag'", [org]).catch(() => {});
      await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
      invalidateAllFlagsForTenant(org);
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    for (const [org, slug] of [[ORG_P, "ffprod-p"], [ORG_Q, "ffprod-q"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)",
        [org, `FF Prod Org ${org}`, slug]).catch(() => {});
    }
    await cleanupProd();
    vi.resetModules();
    vi.doMock("../../config/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../config/env")>()), IS_PRODUCTION: true }));
    prod = await import("../../services/featureFlagAdminService");
  }, 120_000);

  afterAll(async () => {
    vi.doUnmock("../../config/env");
    vi.resetModules();
    await cleanupProd();
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_P, ORG_Q]).catch(() => {});
    await conn.end().catch(() => {});
  });

  it("A/H/J/F: enable em produção cria override SÓ de P, audita atomicamente e Q não é afetado", async () => {
    const r = await write(ORG_P, true, "ffprod-on-1");
    expect(r).toMatchObject({ replayed: false, before: null, after: { enabled: true, percentage: 100 }, effectiveValue: true, origin: "tenant" });
    expect(await tenantRow(ORG_P, CANONICAL_INGESTION_FLAG)).toBe(true);
    expect(await effective(ORG_P)).toBe(true);
    expect(await tenantRow(ORG_Q, CANONICAL_INGESTION_FLAG)).toBeNull();
    expect(await effective(ORG_Q)).toBe(false);
    const [a] = await audits(ORG_P);
    expect(a).toMatchObject({ action: "feature_flag_enabled", userId: ACTOR, correlationId: "corr-ffprod-on-1", requestId: "req-ffprod-on-1" });
    expect(JSON.parse(a.details)).toMatchObject({ flagName: CANONICAL_INGESTION_FLAG, organizationId: ORG_P, before: null, after: { enabled: true }, reason: REASON, idempotencyKey: "ffprod-on-1" });
    expect(await audits(ORG_Q)).toHaveLength(0);
  });

  it("G: leitura administrativa em produção → origin tenant, efetivo true, writeAllowed true", async () => {
    const v = await prod.resolveTenantFlag(CANONICAL_INGESTION_FLAG, ORG_P);
    expect(v).toMatchObject({ origin: "tenant", effectiveValue: true, writeAllowed: true, override: { enabled: true } });
    expect(await prod.resolveTenantFlag(CANONICAL_INGESTION_FLAG, ORG_Q)).toMatchObject({ origin: "default", effectiveValue: false });
  });

  it("I: replay (mesma chave + payload) é idempotente — sem 2ª auditoria, mesmo estado", async () => {
    const before = (await audits(ORG_P)).length;
    const r = await write(ORG_P, true, "ffprod-on-1");
    expect(r.replayed).toBe(true);
    expect((await audits(ORG_P)).length).toBe(before);
    expect(await tenantRow(ORG_P, CANONICAL_INGESTION_FLAG)).toBe(true);
  });

  it("H/7: reversão pelo MESMO mecanismo (disable) → false, audita com before/after", async () => {
    const r = await write(ORG_P, false, "ffprod-off-1");
    expect(r).toMatchObject({ before: { enabled: true }, after: { enabled: false }, effectiveValue: false });
    expect(await effective(ORG_P)).toBe(false);
    const last = (await audits(ORG_P)).at(-1);
    expect(last.action).toBe("feature_flag_disabled");
    expect(JSON.parse(last.details)).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
  });

  it("C: FF_DIRECT_CONTRACT_SHADOW continua FORBIDDEN em produção — sem override, sem auditoria", async () => {
    const auditsBefore = (await audits(ORG_Q)).length;
    await expect(prod.setTenantFlag({ organizationId: ORG_Q, flagName: FF_DIRECT_CONTRACT_SHADOW, enabled: true, reason: REASON,
      idempotencyKey: "ffprod-shadow", actorUserId: ACTOR, correlationId: "corr-shadow" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await tenantRow(ORG_Q, FF_DIRECT_CONTRACT_SHADOW)).toBeNull();
    expect((await audits(ORG_Q)).length).toBe(auditsBefore);
  });

  it("K: se a auditoria falhar, o override sofre rollback (nunca flag alterada sem auditoria)", async () => {
    // correlationId excede varchar(36) em activity_logs → INSERT da auditoria falha (modo strict) DENTRO do tx.
    await expect(write(ORG_Q, true, "ffprod-atomic", { correlationId: "c".repeat(60) })).rejects.toBeTruthy();
    expect(await tenantRow(ORG_Q, CANONICAL_INGESTION_FLAG)).toBeNull();
    expect(await audits(ORG_Q)).toHaveLength(0);
    expect(await effective(ORG_Q)).toBe(false);
  });

  it("D: nenhuma linha GLOBAL criada em feature_flags para FF_CANONICAL_INGESTION", async () => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM feature_flags WHERE name = ?", [CANONICAL_INGESTION_FLAG]);
    expect(Number((rows[0] as any).n)).toBe(0);
  });
});
