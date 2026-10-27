/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `documentEngine.generate` × EMISSÃO concorrente (MySQL REAL, órgãos SINTÉTICOS). A recusa "linhagem já tem versão emitida"
 * precisa valer no PONTO DA ESCRITA (sob o lock da linhagem), não só numa leitura anterior: entre a checagem do router e o
 * lock, uma emissão pode ser concluída (ex.: parecer assinado) — sem a checagem transacional, a geração genérica anexava uma
 * versão `gerado` ACIMA da versão oficial.
 *  G1  interleaving determinístico: a emissão é concluída DEPOIS da checagem do router e ANTES da escrita ⇒ recusa, sem versão espúria
 *  G1b emissor em transação EXTERNA ainda não commitada (lock nomeado já liberado — caso NEW-016, o da promoção oficial): a geração
 *      espera o commit na leitura travada e então recusa
 *  G2  geração depois da emissão ⇒ recusa; repetir a recusa não grava nada; versão emitida intacta
 *  G3  dois escritores genéricos concorrentes na mesma linhagem sem emissão ⇒ versões 1 e 2, sem colisão
 *  G4  linhagem governada (DFD/ETP/TR/Edital do processo) ⇒ FORBIDDEN, nada gravado; viewer/operator ⇒ FORBIDDEN
 *  G5  outro órgão: a emissão no órgão A não bloqueia nem é tocada pela geração no órgão B (mesmo `origin`)
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const tenant = vi.hoisted(() => ({ org: 1, role: "manager" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
// Ponto de injeção do interleaving: a geração aguarda o snapshot da identidade institucional DEPOIS da checagem do router
// e ANTES do lock da linhagem. O gancho roda uma única vez (a emissão concorrente), depois delega ao real.
const race = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }));
vi.mock("../../services/institutionalIdentityService", async (orig) => {
  const actual = await orig<typeof import("../../services/institutionalIdentityService")>();
  return {
    ...actual,
    snapshotInstitutionalIdentity: async (...a: Parameters<typeof actual.snapshotInstitutionalIdentity>) => {
      const h = race.hook; race.hook = null;
      if (h) await h();
      return actual.snapshotInstitutionalIdentity(...a);
    },
  };
});

import { documentEngineRouter } from "../../routers/documentEngineRouter";
import { runMigrations } from "../../bootstrap";
import { createDocument } from "../../services/officialDocumentLifecycleService";
import { computeLineageId } from "../../domain/officialDocument";
import { makeContext, mockUser } from "../helpers/fixtures";
import { getDb } from "../../db/connection";

const DB = process.env.DATABASE_URL;
const ORG_A = 996721;
const ORG_B = 996722;
const RUN = Date.now().toString(36);
let conn: mysql.Connection;
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const caller = (org: number, role = "manager") => { tenant.org = org; tenant.role = role; return documentEngineRouter.createCaller({ ...makeContext(mockUser), correlationId: `corr-race-${RUN}` } as any); };
const versionsOf = (org: number, origin: string, type = "parecer_final") =>
  rows<{ version: number; status: string; content_hash: string | null; id: string }>(
    "SELECT version, status, id, content_hash FROM official_documents WHERE tenant_id = ? AND business_domain = 'parecer_juridico' AND document_type = ? AND origin = ? ORDER BY version",
    [org, type, origin]);
const input = (origin: string, over: Record<string, unknown> = {}) =>
  ({ businessDomain: "parecer_juridico" as const, documentType: "parecer_final" as const, origin, title: "Parecer (sintético)", content: "Texto gerado pelo endpoint genérico.", ...over });
const emit = (org: number, origin: string) => createDocument({
  organizationId: org, businessDomain: "parecer_juridico", documentType: "parecer_final", origin, title: "Parecer jurídico (sintético)",
  content: "Parecer assinado (sintético).", author: "303", status: "emitido", correlationId: `corr-emit-${RUN}`,
});

describe.skipIf(!DB)("documentEngine.generate × emissão concorrente (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Órgão Sintético DE ${org}`, `de-race-${org}`]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
      await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
      await conn.execute("DELETE FROM organizations WHERE id = ?", [org]).catch(() => {});
    }
    await conn.end();
  });

  it("G1 — emissão concluída entre a checagem e a escrita: a geração é recusada e nenhuma versão `gerado` fica acima da oficial", async () => {
    const origin = `ws-g1-${RUN}`;
    race.hook = async () => { await emit(ORG_A, origin); };
    await expect(caller(ORG_A).generate(input(origin))).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("LINEAGE_HAS_EMITTED_VERSION") });
    expect((await versionsOf(ORG_A, origin)).map((v) => [v.version, v.status])).toEqual([[1, "emitido"]]);
  }, 120_000);

  it("G1b — emissão em transação externa ainda NÃO commitada: a geração aguarda o commit e recusa (sem versão espúria)", async () => {
    const origin = `ws-g1b-${RUN}`;
    let emitting: Promise<unknown> = Promise.resolve();
    race.hook = async () => {
      let inserted!: () => void;
      const ready = new Promise<void>((r) => { inserted = r; });
      const db = (await getDb())!;
      // createDocument com executor externo: o GET_LOCK é liberado ao fim da escrita, ANTES do commit (que só vem 400 ms depois).
      emitting = db.transaction(async (tx) => {
        await createDocument({
          organizationId: ORG_A, businessDomain: "parecer_juridico", documentType: "parecer_final", origin, title: "Parecer jurídico (sintético)",
          content: "Parecer assinado (sintético).", author: "303", status: "emitido", correlationId: `corr-emit-ext-${RUN}`,
        }, tx);
        inserted();
        await new Promise((r) => setTimeout(r, 400));
      });
      await ready;
    };
    await expect(caller(ORG_A).generate(input(origin))).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("LINEAGE_HAS_EMITTED_VERSION") });
    await emitting;
    expect((await versionsOf(ORG_A, origin)).map((v) => [v.version, v.status])).toEqual([[1, "emitido"]]);
  }, 120_000);

  it("G2 — depois da emissão: recusa repetível, sem escrita; versão emitida intacta", async () => {
    const origin = `ws-g2-${RUN}`;
    const official = await emit(ORG_A, origin);
    const before = await versionsOf(ORG_A, origin);
    for (let i = 0; i < 2; i++) {
      await expect(caller(ORG_A).generate(input(origin))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    expect(await versionsOf(ORG_A, origin)).toEqual(before);
    expect(before.map((v) => v.id)).toEqual([official.id]);
  }, 120_000);

  it("G3 — dois escritores genéricos concorrentes sem emissão: versões 1 e 2, sem colisão nem perda", async () => {
    const origin = `ws-g3-${RUN}`;
    const out = await Promise.allSettled([caller(ORG_A).generate(input(origin)), caller(ORG_A).generate(input(origin, { content: "outra" }))]);
    expect(out.every((o) => o.status === "fulfilled")).toBe(true);
    expect((await versionsOf(ORG_A, origin)).map((v) => [v.version, v.status])).toEqual([[1, "gerado"], [2, "gerado"]]);
    const lineage = computeLineageId({ tenantId: ORG_A, businessDomain: "parecer_juridico", documentType: "parecer_final", origin });
    expect(Number((await rows("SELECT COUNT(*) n FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage]))[0].n)).toBe(2);
  }, 120_000);

  it("G4 — linhagem governada e papéis abaixo de manager: FORBIDDEN sem escrita", async () => {
    const origin = `proc-g4-${RUN}`;
    for (const t of ["dfd", "etp", "tr", "edital"] as const) {
      await expect(caller(ORG_A).generate({ ...input(origin), businessDomain: "processo_licitatorio", documentType: t })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const r of ["viewer", "operator"]) await expect(caller(ORG_A, r).generate(input(origin))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(Number((await rows("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [ORG_A, origin]))[0].n)).toBe(0);
  }, 120_000);

  it("G5 — outro órgão: emissão em A não bloqueia nem é alterada pela geração em B (mesmo origin)", async () => {
    const origin = `ws-g5-${RUN}`;
    await emit(ORG_A, origin);
    const aBefore = await versionsOf(ORG_A, origin);
    await caller(ORG_B).generate(input(origin));
    expect((await versionsOf(ORG_B, origin)).map((v) => [v.version, v.status])).toEqual([[1, "gerado"]]);
    expect(await versionsOf(ORG_A, origin)).toEqual(aBefore);
  }, 120_000);
});
