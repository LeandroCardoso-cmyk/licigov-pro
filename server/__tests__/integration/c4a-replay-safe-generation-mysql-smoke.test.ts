/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4A — Replay-Safe Canonical Document Generation contra MySQL REAL (CI, modo ESTRITO).
 *
 * Executável (não source inspection). Exercita o COMMIT DOCUMENTAL atômico do pipeline canônico
 * (procurementProcessService.generateDocument) contra o writer real sob STRICT_TRANS_TABLES —
 * generated_document + official_document (versão) + timeline + evento de processo + marcação da
 * idempotency key COMPLETED numa ÚNICA transação. A cognição roda fora da transação (invoke
 * determinístico — NUNCA provider real). Cobre os 7 cenários exigidos:
 *
 *   1. primeira geração        → generated=1, official=1 versão;
 *   2. mesma chave (replay)     → continua 1/1, SEM evento duplicado;
 *   3. concorrência mesma chave → UM único efeito (1/1), sem duplicação;
 *   4. falha após generated, antes do official → rollback total (0/0); retry funciona (1/1);
 *   5. falha após official, antes da conclusão  → rollback total (0/0); retry cria UMA versão final;
 *   6. replay de resposta       → conteúdo/IDs equivalentes, sem novos efeitos;
 *   7. multi-tenant mesma chave → isolado por organização (cada tenant 1/1).
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 990041;
const ORG2 = 990042;
const USER = 5;

// Injeção de falha determinística DENTRO da transação — sem provider real, sem aleatoriedade.
const inject = vi.hoisted(() => ({ failOfficial: false, failEvent: false }));

// official falha ANTES de inserir (simula falha após generated, antes do official).
vi.mock("../../services/documentEngineService", async (orig) => {
  const actual = await orig<typeof import("../../services/documentEngineService")>();
  return {
    ...actual,
    generateOfficialDocument: async (params: any, executor: any) => {
      if (inject.failOfficial) { inject.failOfficial = false; throw new Error("inject-official-fail"); }
      return actual.generateOfficialDocument(params, executor);
    },
  };
});

// recordProcessEvent falha DEPOIS do official (simula falha após official, antes da conclusão).
vi.mock("../../db/procurement", async (orig) => {
  const actual = await orig<typeof import("../../db/procurement")>();
  return {
    ...actual,
    recordProcessEvent: async (params: any, executor: any) => {
      if (inject.failEvent) { inject.failEvent = false; throw new Error("inject-event-fail"); }
      return actual.recordProcessEvent(params, executor);
    },
  };
});

import { generateDocument, canonicalDocumentIdentity } from "../../services/procurementProcessService";

let conn: mysql.Connection;

const genETP = (processId: string, key: string, org = ORG) =>
  generateDocument({
    organizationId: org, processId, kind: "etp", object: "Material de escritório",
    correlationId: "c4a-smoke", idempotencyKey: key, actorUserId: USER,
    invoke: async () => "", // cognição determinística — nunca provider real
  });

async function countGenerated(org: number, processId: string, kind: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = ?",
    [org, processId, kind],
  );
  return Number((rows[0] as any).n);
}

async function countOfficialVersions(org: number, processId: string, kind: string): Promise<number> {
  const { lineageId } = canonicalDocumentIdentity({ organizationId: org, processId, kind: kind as any });
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM official_documents WHERE tenant_id = ? AND lineage_id = ?",
    [org, lineageId],
  );
  return Number((rows[0] as any).n);
}

async function countProcessEvents(org: number, processId: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM process_timeline WHERE organization_id = ? AND process_id = ?",
    [org, processId],
  );
  return Number((rows[0] as any).n);
}

async function idemStatus(org: number, key: string): Promise<string | null> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT status FROM idempotency_keys WHERE organizationId = ? AND userId = ? AND `key` = ?",
    [org, USER, key],
  );
  return rows.length ? String((rows[0] as any).status) : null;
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("C.4A — Replay-Safe Canonical Generation (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    // Modo estrito GLOBAL → o pool getDb() do writer real herda; SESSION para as verificações diretas.
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "C4A Org", "c4a-org"]).catch(() => {});
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG2, "C4A Org 2", "c4a-org-2"]).catch(() => {});
    inject.failOfficial = false; inject.failEvent = false;
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("1) primeira geração → generated=1 e official=1 versão", async () => {
    const pid = "c4a-p1";
    const r = await genETP(pid, "c4a-key-1");
    expect(r.replayed).toBe(false);
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
    expect(await idemStatus(ORG, "c4a-key-1")).toBe("completed");
  }, 60_000);

  it("2) mesma chave (replay) → continua 1/1, SEM evento duplicado", async () => {
    const pid = "c4a-p2";
    await genETP(pid, "c4a-key-2");
    const eventsAfterFirst = await countProcessEvents(ORG, pid);

    const second = await genETP(pid, "c4a-key-2");
    expect(second.replayed).toBe(true);
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
    expect(await countProcessEvents(ORG, pid)).toBe(eventsAfterFirst); // nenhum evento novo
  }, 60_000);

  it("3) concorrência mesma chave → UM único efeito (1/1), sem duplicação", async () => {
    const pid = "c4a-p3";
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => genETP(pid, "c4a-key-3")),
    );
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1); // ao menos o vencedor conclui
    // O efeito documental é único, independentemente de quantas requisições concorreram.
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
  }, 60_000);

  it("4) falha após generated, antes do official → rollback total (0/0); retry funciona (1/1)", async () => {
    const pid = "c4a-p4";
    inject.failOfficial = true;
    await expect(genETP(pid, "c4a-key-4")).rejects.toThrow(/inject-official-fail/);
    // Rollback: nada do documento persistiu; a chave ficou 'failed' (retry permitido).
    expect(await countGenerated(ORG, pid, "etp")).toBe(0);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(0);
    expect(await idemStatus(ORG, "c4a-key-4")).toBe("failed");

    const retry = await genETP(pid, "c4a-key-4");
    expect(retry.replayed).toBe(false);
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
    expect(await idemStatus(ORG, "c4a-key-4")).toBe("completed");
  }, 60_000);

  it("5) falha após official, antes da conclusão → rollback total (0/0); retry cria UMA versão final", async () => {
    const pid = "c4a-p5";
    inject.failEvent = true;
    await expect(genETP(pid, "c4a-key-5")).rejects.toThrow(/inject-event-fail/);
    // O official JÁ inserido na transação é DESFEITO junto — nenhuma versão órfã.
    expect(await countGenerated(ORG, pid, "etp")).toBe(0);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(0);
    expect(await idemStatus(ORG, "c4a-key-5")).toBe("failed");

    const retry = await genETP(pid, "c4a-key-5");
    expect(retry.replayed).toBe(false);
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1); // exatamente UMA versão final
  }, 60_000);

  it("6) replay de resposta → conteúdo/IDs equivalentes, sem novos efeitos", async () => {
    const pid = "c4a-p6";
    const first = await genETP(pid, "c4a-key-6");
    const second = await genETP(pid, "c4a-key-6");
    expect(second.replayed).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(second.document.content).toBe(first.document.content);
    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
  }, 60_000);

  it("7) multi-tenant mesma chave → isolado por organização (cada tenant 1/1)", async () => {
    const pid = "c4a-p7";
    const key = "c4a-key-shared";
    const a = await genETP(pid, key, ORG);
    const b = await genETP(pid, key, ORG2);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false); // tenant distinto → chave própria, sem replay cruzado
    expect(a.document.id).not.toBe(b.document.id); // identidade inclui o tenant

    expect(await countGenerated(ORG, pid, "etp")).toBe(1);
    expect(await countGenerated(ORG2, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG, pid, "etp")).toBe(1);
    expect(await countOfficialVersions(ORG2, pid, "etp")).toBe(1);
    expect(await idemStatus(ORG, key)).toBe("completed");
    expect(await idemStatus(ORG2, key)).toBe("completed");
  }, 60_000);
});
