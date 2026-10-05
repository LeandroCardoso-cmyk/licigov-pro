/**
 * R11 (2º passe) — guardas COMPORTAMENTAIS transversais da autoridade semântica.
 *
 * Complementam as guardas estáticas de `r11-semantic-authority-guards.test.ts`: aqui o código REAL é executado
 * (funções puras, executor de banco falso e propriedades com PRNG semeado), então uma regressão de comportamento
 * quebra o teste mesmo que o texto do código continue "parecendo certo".
 *
 *  R11-B1  os guards comportamentais RODAM de verdade (nenhum `*-mysql-smoke` órfão fora da cadeia da CI / do smoke de segurança);
 *  R11-B2  identidade da timeline — um id por evento, sem reescrita do resumo, ator humano;
 *  R11-B3  autoridade numérica da IA — valor fora do quadro do sistema sempre marcado; estimativa nunca inferida;
 *  R11-B4 objeto canônico — `process.object` vence o objeto digitado;
 *  R11-B5 preço de fonte desatualizada — só fonte vigente gera preço/total, em qualquer estado desconhecido também;
 *  R11-B6 semântica da auditoria de tenant — amostra ≠ varredura; sem banco ⇒ não saudável;
 *  R11-B7 formatação monetária — centavos ⇄ texto sem erro de unidade (×100).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { recordProcessEvent } from "../../db/procurement";
import { timelineActor } from "../../domain/timelineActor";
import { authoritativeAmounts, flagUnverifiedAmounts, serverEstimateProse, UNVERIFIED_AMOUNT_MARK } from "../../domain/aiNumericAuthority";
import { formatBRL } from "../../domain/money";
import { resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, type FactAssertion } from "../../domain/canonicalProcurementContext";
import { buildDocumentAuthoringContext, canonicalDocumentItems, type ContextItem } from "../../services/authoring/authoringContext";
import { scanCrossTenantAccess, detectOrphanedEntities, runFullTenantAudit } from "../../services/tenantIsolationAuditService";
import { sweepTenantScopedTables } from "../../services/tenantIsolationSweepService";
import { formatCentsBRL } from "../../../shared/money";
import { parseReaisInputToDecimal } from "../../../client/src/lib/money";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** PRNG determinístico (LCG) — as propriedades são reproduzíveis. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// ─── R11-B1 — os guards comportamentais rodam de verdade ──────────────────────────────────────────────────────────
describe("R11-B1 — nenhum smoke MySQL órfão (fora da cadeia da CI e do smoke de segurança)", () => {
  /** Órfãos PRÉ-EXISTENTES, conhecidos e fora do escopo desta remediação (cada um com o motivo). */
  const PRE_EXISTING_ORPHANS: Readonly<Record<string, string>> = {
    "a3-failure-provenance-mysql-smoke.test.ts": "pré-existente (A3), fora da cadeia desde a origem",
    "catmat-governance-mysql-smoke.test.ts": "pré-existente (CATMAT legado), fora da cadeia desde a origem",
    "cognitive-provenance-a1-mysql-smoke.test.ts": "pré-existente (A1), fora da cadeia desde a origem",
    "contrato-avulso-mysql-smoke.test.ts": "pré-existente (contrato avulso), fora da cadeia desde a origem",
    "document-generation-mysql-smoke.test.ts": "pré-existente: falha NO_ORGANIZATION_MEMBERSHIP na main com DATABASE_URL (fixture)",
    "invitations-mysql-smoke.test.ts": "NEW-037: falha 2/10 também na main (fixture `res` sem `cookie`)",
    "p0-edital-generation-mysql-smoke.test.ts": "pré-existente (P0 Edital), fora da cadeia desde a origem",
  };
  it("todo `*-mysql-smoke.test.ts` está em .github/workflows/ci.yml ou em `test:smoke:security` (ou é órfão conhecido)", () => {
    const ci = read(".github/workflows/ci.yml");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const security = pkg.scripts["test:smoke:security"] ?? "";
    const dir = "server/__tests__/integration";
    const smokes = readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith("-mysql-smoke.test.ts"));
    expect(smokes.length).toBeGreaterThan(50);
    const orphans = smokes.filter((f) => !ci.includes(f) && !security.includes(f) && !(f in PRE_EXISTING_ORPHANS));
    expect(orphans, `smokes fora da cadeia (adicione à CI ou ao smoke de segurança): ${orphans.join(", ")}`).toEqual([]);
  });
  it("a lista de órfãos conhecidos não envelhece: nenhum deles já está na cadeia", () => {
    const ci = read(".github/workflows/ci.yml");
    const security = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts["test:smoke:security"] ?? "";
    const stale = Object.keys(PRE_EXISTING_ORPHANS).filter((f) => ci.includes(f) || security.includes(f));
    expect(stale).toEqual([]);
  });
  it("os guards de idempotência e de timeline (SEM-075/076) existem e são executados pela CI", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const f of ["r9-sem075-idempotency-rereserve-mysql-smoke.test.ts", "r9-sem076-timeline-identity-mysql-smoke.test.ts"]) {
      expect(readdirSync(path.join(ROOT, "server/__tests__/integration"))).toContain(f);
      expect(ci).toContain(f);
    }
  });
});

// ─── R11-B2 — identidade da timeline ───────────────────────────────────────────────────────────────────────────────
describe("R11-B2 — timeline: um id por evento, sem reescrever o resumo; ator humano", () => {
  type Rec = { row: Record<string, unknown>; upsert?: { set?: Record<string, unknown> } };
  function fakeExecutor(existingRows = 0) {
    const inserts: Rec[] = [];
    const executor = {
      select: () => ({ from: () => ({ where: async () => Array.from({ length: existingRows }, (_, i) => ({ id: `e${i}` })) }) }),
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          const rec: Rec = { row };
          inserts.push(rec);
          const p = Promise.resolve() as Promise<void> & { onDuplicateKeyUpdate: (a: Rec["upsert"]) => Promise<void> };
          p.onDuplicateKeyUpdate = async (arg) => { rec.upsert = arg; };
          return p;
        },
      }),
    };
    return { executor: executor as unknown as Parameters<typeof recordProcessEvent>[1], inserts };
  }
  const base = { organizationId: 7, processId: "proc-1", eventType: "rascunho_gerado", actor: "user:5", correlationId: "corr" };

  it("N eventos do MESMO tipo lendo a MESMA contagem ⇒ N ids distintos (nenhum sobrescreve o outro)", async () => {
    const { executor, inserts } = fakeExecutor(3); // todos leem count = 3 (concorrência)
    await Promise.all(Array.from({ length: 25 }, (_, i) => recordProcessEvent({ ...base, summary: `resumo ${i}` }, executor)));
    const ids = inserts.map((r) => String(r.row.id));
    expect(new Set(ids).size).toBe(25);
    expect(inserts.every((r) => r.upsert === undefined), "evento sem chave NUNCA usa upsert (não reescreve resumo)").toBe(true);
    expect(inserts.map((r) => r.row.summary)).toEqual(Array.from({ length: 25 }, (_, i) => `resumo ${i}`));
  });
  it("evento singleton com chave: mesmo id no retry e o upsert é um NO-OP (não toca o resumo original)", async () => {
    const { executor, inserts } = fakeExecutor(0);
    const k = { ...base, eventType: "processo_criado", idempotencyKey: "initial" };
    await recordProcessEvent({ ...k, summary: "original" }, executor);
    await recordProcessEvent({ ...k, summary: "retry com texto diferente" }, executor);
    expect(String(inserts[0].row.id)).toBe(String(inserts[1].row.id));
    for (const r of inserts) {
      expect(Object.keys(r.upsert?.set ?? {})).toEqual(["id"]); // `id = id`
      expect(r.upsert?.set).not.toHaveProperty("summary");
    }
  });
  it("chaves diferentes ou tipos diferentes ⇒ ids diferentes (sem colisão entre o espaço com chave e o sem chave)", async () => {
    const { executor, inserts } = fakeExecutor(0);
    await recordProcessEvent({ ...base, summary: "a", idempotencyKey: "k1" }, executor);
    await recordProcessEvent({ ...base, summary: "a", idempotencyKey: "k2" }, executor);
    await recordProcessEvent({ ...base, summary: "a", eventType: "outro", idempotencyKey: "k1" }, executor);
    await recordProcessEvent({ ...base, summary: "a" }, executor);
    expect(new Set(inserts.map((r) => String(r.row.id))).size).toBe(4);
  });
  it("o ator é o humano solicitante (`user:<id>`) ou `sistema` — nunca `multi_copilot`", () => {
    for (const id of [1, 42, 999_999]) expect(timelineActor(id)).toBe(`user:${id}`);
    for (const none of [null, undefined, Number.NaN]) {
      expect(timelineActor(none as number | null | undefined)).toBe("sistema");
    }
    const spreadsheet = [timelineActor(1), timelineActor(null)].join("|");
    expect(spreadsheet).not.toMatch(/multi_copilot/);
  });
});

// ─── R11-B3 — autoridade numérica da IA ────────────────────────────────────────────────────────────────────────────
describe("R11-B3 — a IA não cria autoridade numérica (propriedades com PRNG semeado)", () => {
  const table = { itemCount: 2, pricedItemCount: 2, unpricedItemCount: 0, globalTotalCents: 345_600, rows: [
    { averagePriceCents: 1_000, estimatedTotalCents: 100_000 }, { averagePriceCents: 2_456, estimatedTotalCents: 245_600 },
  ], missingPlannedQuantity: 0, hasAuthoritativeBlock: true };
  const allowed = authoritativeAmounts(table);

  it("valor fora do quadro é SEMPRE marcado [REVISAR]; valor do quadro nunca; segunda passada não remarca", () => {
    const rnd = prng(20261004);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const cents = 1 + Math.floor(rnd() * 99_999_999);
      if (allowed.has(cents)) continue;
      const out = flagUnverifiedAmounts(`O valor estimado seria de ${formatBRL(cents)} no total.`, allowed);
      expect(out.flagged, formatBRL(cents)).toBe(1);
      expect(out.prose).toContain(`${formatBRL(cents)} ${UNVERIFIED_AMOUNT_MARK}`);
      expect(flagUnverifiedAmounts(out.prose, allowed).flagged).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(250);
    for (const ok of allowed) expect(flagUnverifiedAmounts(`Item a ${formatBRL(ok)}.`, allowed).flagged).toBe(0);
  });
  it("a estimativa do servidor nunca infere valor quando falta quantidade ou item; com dados traz o total do quadro", () => {
    expect(serverEstimateProse({ ...table, missingPlannedQuantity: 1 })).not.toContain("R$");
    expect(serverEstimateProse({ ...table, itemCount: 0, pricedItemCount: 0, rows: [], globalTotalCents: 0 })).not.toContain("R$");
    expect(serverEstimateProse(table)).toContain(formatBRL(345_600));
  });
});

// ─── R11-B4 / R11-B5 — objeto canônico e preço de fonte desatualizada ─────────────────────────────────────────────
describe("R11-B4 — o objeto do documento é process.object (o digitado é só proposta)", () => {
  it("para qualquer objeto digitado diferente, o prompt traz o do processo e a divergência vira proposta", () => {
    const rnd = prng(7);
    for (let i = 0; i < 40; i++) {
      const typed = `Objeto digitado ${Math.floor(rnd() * 1e9)}`;
      for (const kind of ["etp", "tr"] as const) {
        const d = buildDocumentAuthoringContext({
          organizationId: 7, processId: "p1", kind, object: typed, processObject: "Aquisição de detergente", processNumber: "9/2026",
          dfd: null, etp: null, approvedItems: [], pendingItemCount: 0,
        });
        expect(d.promptContext).toContain("Aquisição de detergente");
        expect(d.promptContext).not.toContain(typed);
        expect(d.objectProposal).toEqual({ current: "Aquisição de detergente", proposed: typed, source: "client_input" });
      }
    }
  });
  it("todo ponto de chamada dos builders de contexto passa `processObject` (nenhum caller novo esquece a autoridade)", () => {
    const files = ["server/services/procurementProcessService.ts", "server/services/authoring/authoringContext.ts", "server/services/authoring/editalContext.ts"];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/(buildDocumentAuthoringContext|buildEditalSourceContext)\(\{([\s\S]*?)\}\)/g)) {
        if (/function\s/.test(m[0])) continue;
        expect(m[2], `${f}: ${m[1]}(...) sem processObject`).toMatch(/processObject/);
      }
    }
  });
});

describe("R11-B5 — preço só de Item Inteligente com fonte VIGENTE (qualquer outro estado suspende)", () => {
  const A = "a1a1a1a1a1a1a1a1a1a1a1a1";
  const planned: FactAssertion = {
    id: 1, path: itemPath(A, "plannedQuantity"), value: 10, valueHash: factValueHash(10), sourceType: "user", sourceId: "items-area",
    sourceVersion: "r1:informed", status: "confirmed", actorUserId: 5, basisValueHash: null, createdAt: "2026-02-01T00:00:00.000Z",
  };
  const ctxFor = (sourceState: string) => resolveCanonicalContext({
    organizationId: 7, processId: "p1", process: { number: "1", object: "Limpeza", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    organization: null, assertions: [planned],
    intelligentItems: [{ id: "ii1", description: "Detergente", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 1000, quoteCount: 3, sourceState }],
    procurementItems: [{ id: A, description: "Detergente", unit: "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: canonicalItemKey("Detergente", "UN") }],
    priceLinks: [{ itemId: A, intelligentItemId: "ii1" }],
  });
  const approved = (sourceState: string): ContextItem => ({
    id: "ii1", description: "Detergente", quantity: 1, unit: "UN", averagePriceCents: 1000, quoteCount: 3,
    confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState, quotes: [],
  });

  it("current ⇒ preço e total; source_changed/review_required/estado desconhecido ⇒ sem preço, sem total, digest diferente", () => {
    const ok = ctxFor("current");
    expect(ok.items[0].priceContext.unitReferencePriceCents).toBe(1000);
    expect(ok.items[0].estimatedTotalCents).toBe(10_000);
    for (const state of ["source_changed", "review_required", "stale_xyz", ""]) {
      const c = ctxFor(state);
      expect(c.items[0].priceContext.unitReferencePriceCents, `estado "${state}"`).toBeNull();
      expect(c.items[0].estimatedTotalCents, `estado "${state}"`).toBeNull();
      expect(c.digest).not.toBe(ok.digest);
    }
  });
  it("o quadro autoritativo de ETP/TR nunca traz preço de item com fonte alterada", () => {
    for (const kind of ["etp", "tr"] as const) {
      const p = canonicalDocumentItems(ctxFor("source_changed"), [approved("source_changed")]);
      const d = buildDocumentAuthoringContext({
        organizationId: 7, processId: "p1", kind, object: "Limpeza", processObject: "Limpeza", processNumber: "1",
        dfd: null, etp: null, approvedItems: p.items, pendingItemCount: 0, canonical: p.state,
      });
      expect(d.authoritativeBlock, kind).toContain("[REVISAR");
      expect(d.authoritativeBlock, kind).not.toContain("10,00 |");
    }
  });
});

// ─── R11-B6 — semântica da auditoria de tenant ────────────────────────────────────────────────────────────────────
describe("R11-B6 — auditoria de tenant: amostra do chamador ≠ varredura do banco", () => {
  it("toda auditoria baseada em registros fornecidos se declara `caller_supplied_sample` (nunca 'banco íntegro')", () => {
    const quiet = console.info; console.info = () => {};
    try {
      expect(scanCrossTenantAccess(1, [{ table: "t", records: [{ id: 1, organizationId: 1 }] }]).coverage).toBe("caller_supplied_sample");
      // detectOrphanedEntities devolve só achados; o rótulo de cobertura vem do resultado agregado
      expect(detectOrphanedEntities(1, [{ table: "t", records: [{ id: 1, organizationId: 0 }] }])).toHaveLength(1);
      const cache = { set: () => {}, get: () => null, invalidate: () => {} } as unknown as Parameters<typeof runFullTenantAudit>[1]["cacheService"];
      const full = runFullTenantAudit(1, { entities: [{ table: "t", records: [{ id: 1, organizationId: 1 }] }], cacheService: cache });
      expect(full.coverage).toBe("caller_supplied_sample");
      expect(full.healthy).toBe(true); // "limpo" aqui significa só "a amostra fornecida está limpa"
    } finally { console.info = quiet; }
  });
  it("a varredura sem banco NÃO se declara saudável; com banco declara `database_sweep`", async () => {
    const down = await sweepTenantScopedTables({ db: null });
    expect(down).toMatchObject({ coverage: "database_sweep", available: false, healthy: false, tablesCovered: [] });
    const empty = await sweepTenantScopedTables({ registry: [], db: {} as never });
    expect(empty.coverage).toBe("database_sweep");
  });
});

// ─── R11-B7 — formatação monetária ────────────────────────────────────────────────────────────────────────────────
describe("R11-B7 — centavos ⇄ texto sem erro de unidade", () => {
  it("formatador único: cliente/servidor idênticos e determinísticos", () => {
    const cases: Array<[number, string]> = [[0, "R$ 0,00"], [5, "R$ 0,05"], [100, "R$ 1,00"], [123_456, "R$ 1.234,56"], [100_000_000, "R$ 1.000.000,00"], [-250, "-R$ 2,50"]];
    for (const [c, s] of cases) {
      expect(formatCentsBRL(c)).toBe(s);
      expect(formatBRL(c)).toBe(s);
    }
    expect(formatCentsBRL(null)).toBe("R$ 0,00");
  });
  it("texto em reais ⇒ reais (NUNCA ×100): ida e volta preservam o valor (propriedade)", () => {
    const rnd = prng(99);
    for (let i = 0; i < 300; i++) {
      const cents = 1 + Math.floor(rnd() * 5_000_000);
      const text = formatCentsBRL(cents).replace("R$ ", ""); // "1.234,56"
      expect(parseReaisInputToDecimal(text), text).toBe(cents / 100);
    }
    expect(parseReaisInputToDecimal("1.234,56")).not.toBe(123_456);
  });
});
