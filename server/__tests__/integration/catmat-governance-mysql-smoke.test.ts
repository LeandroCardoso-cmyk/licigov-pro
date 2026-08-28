/**
 * PR C.2 / V1 hardening — Governança operacional CATMAT/CATSER contra MySQL REAL (CI). Executável.
 *
 * Cobre a persistência supervisionada ponta a ponta:
 *   - THRESHOLD FAIL-CLOSED REAL: sem limiar institucional ativo, a decisão é RECUSADA
 *     (PRECONDITION_FAILED) ANTES de qualquer efeito — ledger vazio, item sem CATMAT;
 *   - LEDGER IMUTÁVEL: cada decisão humana anexa uma linha (append-only), com proveniência,
 *     correlationId, ator e o LIMIAR em vigor no momento;
 *   - IDEMPOTÊNCIA canônica: mesma chave + mesmo payload → replay (linha única); mesma chave +
 *     payload diferente (inclusive catmatDescription) → CONFLICT;
 *   - LIMIAR VERSIONADO: setCatmatThresholdConfig cria nova versão ativa e inativa a anterior;
 *   - ISOLAMENTO MULTI-TENANT: chave/limiar não vazam entre orgs.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { decideCatmat, type AvailableSuggestion } from "../../services/catmatGovernanceService";
import {
  getActiveCatmatThreshold, setCatmatThresholdConfig, listCatmatDecisions, getLatestCatmatDecision,
} from "../../db/catmatGovernance";

const DB = process.env.DATABASE_URL;
const ORG_A = 994401;
const ORG_B = 994402;
const ORG_NOTHRESH = 994403; // NUNCA recebe limiar — prova o fail-closed real
const USER = 7;

const SUGGESTIONS: AvailableSuggestion[] = [
  { id: "s1", catmatCode: "111111", catmatDescription: "caneta esferográfica azul", score: 0.92, source: "catalogo-interno" },
  { id: "s2", catmatCode: "222222", catmatDescription: "lápis preto nº 2", score: 0.40, source: "sugestao-ia" },
];

const decParams = (org: number, over: Record<string, unknown>) => ({
  organizationId: org,
  actorUserId: USER,
  correlationId: `corr-c2-${org}`,
  itemId: "item-smoke",
  processId: "proc-smoke",
  suggestions: SUGGESTIONS,
  ...over,
}) as Parameters<typeof decideCatmat>[0];

async function cleanup(conn: mysql.Connection) {
  for (const org of [ORG_A, ORG_B, ORG_NOTHRESH]) {
    await conn.query("DELETE FROM `catmat_decisions` WHERE organizationId = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `idempotency_keys` WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("PR C.2 — Governança CATMAT/CATSER (MySQL real)", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    await cleanup(conn);
    // ORG_A recebe um limiar ativo (papel autorizado em runtime) — pré-condição das decisões governadas.
    await setCatmatThresholdConfig({ organizationId: ORG_A, minScore: 0.5, reason: "smoke-setup", actorUserId: USER, correlationId: "corr-setup-a" });
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("THRESHOLD FAIL-CLOSED: sem limiar ativo → PRECONDITION_FAILED, ledger vazio, item sem CATMAT", async () => {
    expect(await getActiveCatmatThreshold(ORG_NOTHRESH)).toBeNull();
    await expect(
      decideCatmat(decParams(ORG_NOTHRESH, { idempotencyKey: "c2-noThreshold-1", decision: "confirmado", suggestionId: "s1" })),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // Nenhuma entrada no ledger e nenhuma decisão para o item.
    expect((await listCatmatDecisions("item-smoke", ORG_NOTHRESH)).length).toBe(0);
    expect(await getLatestCatmatDecision("item-smoke", ORG_NOTHRESH)).toBeNull();
  }, 60_000);

  it("após o gestor configurar o limiar, a decisão prossegue e capta o limiar vigente", async () => {
    await setCatmatThresholdConfig({ organizationId: ORG_NOTHRESH, minScore: 0.55, reason: "config", actorUserId: USER, correlationId: "corr-nt" });
    const { decision, replayed } = await decideCatmat(decParams(ORG_NOTHRESH, {
      idempotencyKey: "c2-afterThreshold", decision: "confirmado", suggestionId: "s1",
    }));
    expect(replayed).toBe(false);
    expect(decision.decision).toBe("confirmado");
    expect(decision.catmatCode).toBe("111111");
    expect(decision.thresholdMinScore).toBeCloseTo(0.55, 5);
    expect(decision.thresholdConfigId).not.toBeNull();
  }, 60_000);

  it("as QUATRO decisões governadas funcionam sob limiar ativo", async () => {
    const item = "item-4dec";
    const c = await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "d-conf", decision: "confirmado", suggestionId: "s1" }));
    expect(c.decision.decision).toBe("confirmado");
    const r = await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "d-rej", decision: "rejeitado", suggestionId: "s2", justification: "fora do escopo" }));
    expect(r.decision.decision).toBe("rejeitado");
    const s = await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "d-sub", decision: "substituido", catmatCode: "888888", catmatDescription: "código oficial", justification: "correção" }));
    expect(s.decision.decision).toBe("substituido");
    expect(s.decision.catmatCode).toBe("888888");
    const n = await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "d-none", decision: "sem_correspondencia_segura", justification: "nenhum adequado" }));
    expect(n.decision.decision).toBe("sem_correspondencia_segura");
    expect(n.decision.catmatCode).toBeNull();
  }, 60_000);

  it("IDEMPOTÊNCIA: mesma chave + mesmo payload → replay, sem segunda linha", async () => {
    const p = decParams(ORG_A, { idempotencyKey: "c2-replay", decision: "rejeitado", suggestionId: "s2", justification: "fora do escopo" });
    const first = await decideCatmat(p);
    expect(first.replayed).toBe(false);
    const before = (await listCatmatDecisions("item-smoke", ORG_A)).length;

    const second = await decideCatmat(p);
    expect(second.replayed).toBe(true);
    const after = (await listCatmatDecisions("item-smoke", ORG_A)).length;
    expect(after).toBe(before); // nenhuma linha nova no replay
  }, 60_000);

  it("IDEMPOTÊNCIA: mesma chave + payload diferente → CONFLICT", async () => {
    await decideCatmat(decParams(ORG_A, { idempotencyKey: "c2-conflict", decision: "confirmado", suggestionId: "s1" }));
    await expect(
      decideCatmat(decParams(ORG_A, { idempotencyKey: "c2-conflict", decision: "rejeitado", suggestionId: "s2", justification: "mudou" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("IDEMPOTÊNCIA: mesma chave + catmatDescription diferente → CONFLICT (descrição participa do payload)", async () => {
    const item = "item-desc";
    await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "c2-desc", decision: "substituido", catmatCode: "888888", catmatDescription: "descrição A", justification: "manual" }));
    await expect(
      decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "c2-desc", decision: "substituido", catmatCode: "888888", catmatDescription: "descrição B", justification: "manual" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("LIMIAR VERSIONADO: setar cria versão ativa e inativa a anterior (valor vem do chamador)", async () => {
    const v1 = await setCatmatThresholdConfig({ organizationId: ORG_B, minScore: 0.5, reason: "piloto", actorUserId: USER, correlationId: "corr-thr-1" });
    expect(v1?.version).toBe(1);
    const active1 = await getActiveCatmatThreshold(ORG_B);
    expect(active1?.minScore).toBeCloseTo(0.5, 5);
    expect(active1?.version).toBe(1);

    const v2 = await setCatmatThresholdConfig({ organizationId: ORG_B, minScore: 0.7, reason: "ajuste institucional", actorUserId: USER, correlationId: "corr-thr-2" });
    expect(v2?.version).toBe(2);
    const active2 = await getActiveCatmatThreshold(ORG_B);
    expect(active2?.minScore).toBeCloseTo(0.7, 5);
    expect(active2?.version).toBe(2); // apenas uma ativa; a v1 permanece (inativa)

    const { decision } = await decideCatmat(decParams(ORG_B, { idempotencyKey: "c2-with-threshold", decision: "confirmado", suggestionId: "s1" }));
    expect(decision.thresholdMinScore).toBeCloseTo(0.7, 5);
    expect(decision.thresholdConfigId).not.toBeNull();
  }, 60_000);

  it("LEDGER IMUTÁVEL: histórico acumula decisões (mais recente primeiro) e a vigente é a última", async () => {
    const item = "item-history";
    await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "h-1", decision: "confirmado", suggestionId: "s1" }));
    await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "h-2", decision: "rejeitado", suggestionId: "s2", justification: "revisão" }));
    await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: "h-3", decision: "substituido", catmatCode: "888888", justification: "código oficial" }));

    const history = await listCatmatDecisions(item, ORG_A);
    expect(history.length).toBe(3);
    expect(history[0].decision).toBe("substituido"); // desc por id
    const current = await getLatestCatmatDecision(item, ORG_A);
    expect(current?.decision).toBe("substituido");
    expect(current?.catmatCode).toBe("888888");
  }, 60_000);

  it("ISOLAMENTO MULTI-TENANT: MESMA idempotencyKey em orgs distintas → linhas independentes", async () => {
    const item = "item-tenant";
    const KEY = "shared-key-cross-tenant";
    const a = await decideCatmat(decParams(ORG_A, { itemId: item, idempotencyKey: KEY, decision: "confirmado", suggestionId: "s1" }));
    const b = await decideCatmat(decParams(ORG_B, { itemId: item, idempotencyKey: KEY, decision: "confirmado", suggestionId: "s1" }));
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false); // org B não é replay da org A: chave é tenant-aware

    const histA = await listCatmatDecisions(item, ORG_A);
    const histB = await listCatmatDecisions(item, ORG_B);
    expect(histA.length).toBe(1);
    expect(histB.length).toBe(1);
    expect(histA.every(d => d.itemId === item)).toBe(true);
  }, 60_000);

  it("ISOLAMENTO MULTI-TENANT: limiar de uma org não é visível na outra", async () => {
    const onlyB = 994499;
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId = ?", [onlyB]).catch(() => {});
    await setCatmatThresholdConfig({ organizationId: onlyB, minScore: 0.6, reason: "isolado", actorUserId: USER, correlationId: "corr-iso" });
    expect(await getActiveCatmatThreshold(onlyB)).not.toBeNull();
    expect((await getActiveCatmatThreshold(onlyB))?.minScore).toBeCloseTo(0.6, 5);
    expect(await getActiveCatmatThreshold(994498)).toBeNull(); // org sem configuração permanece fail-closed
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId = ?", [onlyB]).catch(() => {});
  }, 60_000);
});
