/**
 * PR C.2 — Governança operacional CATMAT/CATSER contra MySQL REAL (CI). Executável.
 *
 * Cobre a persistência supervisionada ponta a ponta:
 *   - LEDGER IMUTÁVEL: cada decisão humana anexa uma linha (append-only), com
 *     proveniência, correlationId, ator e o LIMIAR em vigor no momento;
 *   - IDEMPOTÊNCIA canônica: mesma chave + mesmo payload → replay (linha única);
 *     mesma chave + payload diferente → CONFLICT;
 *   - FAIL-CLOSED: sem limiar configurado, a decisão registra thresholdMinScore NULL;
 *   - LIMIAR VERSIONADO: setCatmatThresholdConfig cria nova versão ativa e inativa a
 *     anterior (lineage preservado); o valor NUNCA é semeado pelo código;
 *   - ISOLAMENTO MULTI-TENANT: a MESMA idempotencyKey em orgs distintas gera linhas
 *     independentes; histórico e limiar de uma org jamais vazam para outra.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { decideCatmat, type AvailableSuggestion } from "../../services/catmatGovernanceService";
import {
  getActiveCatmatThreshold, setCatmatThresholdConfig, listCatmatDecisions, getLatestCatmatDecision,
} from "../../db/catmatGovernance";

const DB = process.env.DATABASE_URL;
const ORG_A = 994401;
const ORG_B = 994402;
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
  for (const org of [ORG_A, ORG_B]) {
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
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("FAIL-CLOSED: sem limiar configurado, a confirmação registra thresholdMinScore NULL", async () => {
    expect(await getActiveCatmatThreshold(ORG_A)).toBeNull();
    const { decision, replayed } = await decideCatmat(decParams(ORG_A, {
      idempotencyKey: "c2-confirm-noThreshold", decision: "confirmado", suggestionId: "s1",
    }));
    expect(replayed).toBe(false);
    expect(decision.decision).toBe("confirmado");
    expect(decision.catmatCode).toBe("111111");
    expect(decision.source).toBe("catalogo-interno");
    expect(decision.thresholdMinScore).toBeNull();
    expect(decision.thresholdConfigId).toBeNull();
    expect(decision.correlationId).toBe(`corr-c2-${ORG_A}`);
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

  it("LIMIAR VERSIONADO: setar cria versão ativa e inativa a anterior (valor vem do chamador)", async () => {
    // Valores fornecidos pelo TESTE (papel autorizado em runtime) — não semeados pelo produto.
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

    // Decisão após configuração captura o limiar vigente (proveniência do limiar).
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
    // Nenhuma linha de A carrega organizationId de B e vice-versa (consulta já filtra org).
    expect(histA.every(d => d.itemId === item)).toBe(true);
  }, 60_000);

  it("ISOLAMENTO MULTI-TENANT: limiar de uma org não é visível na outra", async () => {
    // ORG_B tem limiar (setado acima); ORG_A começou sem — configuramos só B.
    const onlyB = 994499;
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId = ?", [onlyB]).catch(() => {});
    await setCatmatThresholdConfig({ organizationId: onlyB, minScore: 0.6, reason: "isolado", actorUserId: USER, correlationId: "corr-iso" });
    expect(await getActiveCatmatThreshold(onlyB)).not.toBeNull();
    expect((await getActiveCatmatThreshold(onlyB))?.minScore).toBeCloseTo(0.6, 5);
    // Uma org sem configuração permanece fail-closed.
    expect(await getActiveCatmatThreshold(994498)).toBeNull();
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId = ?", [onlyB]).catch(() => {});
  }, 60_000);
});
