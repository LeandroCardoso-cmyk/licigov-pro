/**
 * F2 (homologação V1) — Transição de Item Inteligente CONCORRÊNCIA-SEGURA contra MySQL REAL.
 *
 * Prova a fronteira REAL de persistência/concorrência do compare-and-set atômico
 * (`transitionItemStatusCAS`) e do orquestrador governado (`applyGovernedItemTransition`):
 *
 *  - duas aprovações SIMULTÂNEAS do mesmo item pendente: nenhuma 500; estado final `aprovado`;
 *    EXATAMENTE UMA transição efetiva (um vencedor no CAS) e EXATAMENTE UM evento na timeline;
 *  - duas rejeições SIMULTÂNEAS: estado final `rejeitado`; exatamente um evento;
 *  - estado incompatível → TRPCError CONFLICT (sem novo efeito nem evento);
 *  - ATOMICIDADE CAS+evento: falha no registro do evento faz ROLLBACK do CAS (sem commit parcial).
 *
 * NÃO reimplementa a lógica do router — exercita as funções reais que tocam o banco.
 * Só roda com DATABASE_URL (CI com MySQL efêmero); PULADO sem banco.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { createIntelligentItem, itemTransitionSources } from "../../domain/intelligentItem";
import {
  insertIntelligentItem, getIntelligentItem, transitionItemStatusCAS, listProcessTimeline,
} from "../../db/procurement";
import { applyGovernedItemTransition } from "../../services/itemIntelligenceService";

const DB = process.env.DATABASE_URL;
const ORG = 995501;
const ORG_OTHER = 995502; // isolamento multi-tenant
const USER = 7;

/** Cria e persiste um item PENDENTE novo, com processId próprio (timeline isolada). */
async function seedPendingItem(processId: string, org = ORG) {
  const item = createIntelligentItem({
    organizationId: org, processId, sourceResearchId: `res-${processId}`.slice(0, 20),
    description: `Item ${processId}`, quantity: 5, unit: "un", correlationId: `corr-${processId}`,
  });
  await insertIntelligentItem(item);
  return item;
}

async function cleanup(conn: mysql.Connection) {
  for (const org of [ORG, ORG_OTHER]) {
    await conn.query("DELETE FROM `intelligent_items` WHERE organization_id = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `process_timeline` WHERE organization_id = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("F2 — transição de item concorrência-segura (MySQL real)", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("compare-and-set: duas transições concorrentes têm EXATAMENTE UM vencedor", async () => {
    const item = await seedPendingItem("proc-cas");
    const sources = itemTransitionSources("aprovado");
    const [a, b] = await Promise.all([
      transitionItemStatusCAS({ id: item.id, orgId: ORG, fromStatuses: sources, toStatus: "aprovado", approvedBy: USER, updatedAt: new Date().toISOString() }),
      transitionItemStatusCAS({ id: item.id, orgId: ORG, fromStatuses: sources, toStatus: "aprovado", approvedBy: USER, updatedAt: new Date().toISOString() }),
    ]);
    // Exatamente um aplicou a transição (single-winner atômico).
    expect([a.applied, b.applied].filter(Boolean).length).toBe(1);
    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("aprovado");
  }, 60_000);

  it("duas APROVAÇÕES simultâneas: sem 500, estado final aprovado, exatamente UM evento", async () => {
    const item = await seedPendingItem("proc-approve-conc");
    const approve = () => applyGovernedItemTransition({
      itemId: item.id, orgId: ORG, target: "aprovado", approvedBy: USER,
      actorUserId: USER, correlationId: "corr-approve", eventType: "approval",
      summary: (d) => `Item aprovado: ${d}.`,
    });
    const results = await Promise.all([approve(), approve()]); // não lança (sem 500)
    for (const r of results) expect(r.status).toBe("aprovado");

    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("aprovado");

    const timeline = await listProcessTimeline("proc-approve-conc", ORG);
    const approvals = timeline.filter((e) => e.eventType === "approval" && e.refId === item.id);
    expect(approvals.length).toBe(1); // exatamente um evento efetivo
  }, 60_000);

  it("duas REJEIÇÕES simultâneas: estado final rejeitado, exatamente UM evento", async () => {
    const item = await seedPendingItem("proc-reject-conc");
    const reject = () => applyGovernedItemTransition({
      itemId: item.id, orgId: ORG, target: "rejeitado", approvedBy: null,
      actorUserId: USER, correlationId: "corr-reject", eventType: "decision",
      summary: (d) => `Item rejeitado: ${d}.`,
    });
    const results = await Promise.all([reject(), reject()]);
    for (const r of results) expect(r.status).toBe("rejeitado");

    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("rejeitado");

    const timeline = await listProcessTimeline("proc-reject-conc", ORG);
    const decisions = timeline.filter((e) => e.eventType === "decision" && e.refId === item.id);
    expect(decisions.length).toBe(1);
  }, 60_000);

  it("estado incompatível → CONFLICT, sem novo efeito nem evento", async () => {
    const item = await seedPendingItem("proc-conflict");
    // Leva a aprovado primeiro (um evento de approval).
    await applyGovernedItemTransition({
      itemId: item.id, orgId: ORG, target: "aprovado", approvedBy: USER,
      actorUserId: USER, correlationId: "corr-conf", eventType: "approval",
      summary: (d) => `Item aprovado: ${d}.`,
    });
    // Rejeitar um item já aprovado é transição inválida → CONFLICT (não 500).
    await expect(
      applyGovernedItemTransition({
        itemId: item.id, orgId: ORG, target: "rejeitado", approvedBy: null,
        actorUserId: USER, correlationId: "corr-conf", eventType: "decision",
        summary: (d) => `Item rejeitado: ${d}.`,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("aprovado"); // inalterado
    const timeline = await listProcessTimeline("proc-conflict", ORG);
    expect(timeline.filter((e) => e.eventType === "decision").length).toBe(0); // nenhum evento de rejeição
    expect(timeline.filter((e) => e.eventType === "approval").length).toBe(1);
  }, 60_000);

  it("convergência idempotente: reaprovar item já aprovado é sucesso SEM novo evento", async () => {
    const item = await seedPendingItem("proc-idem");
    const approve = () => applyGovernedItemTransition({
      itemId: item.id, orgId: ORG, target: "aprovado", approvedBy: USER,
      actorUserId: USER, correlationId: "corr-idem", eventType: "approval",
      summary: (d) => `Item aprovado: ${d}.`,
    });
    await approve();
    await approve(); // segunda vez (replay) — não deve registrar novo evento
    const timeline = await listProcessTimeline("proc-idem", ORG);
    expect(timeline.filter((e) => e.eventType === "approval").length).toBe(1);
  }, 60_000);

  it("ATOMICIDADE: falha no registro do evento faz ROLLBACK do CAS (sem commit parcial)", async () => {
    const item = await seedPendingItem("proc-rollback");
    // Falha controlada REAL do evento dentro da transação: um eventType acima do limite da coluna
    // `process_timeline.event_type` (VARCHAR 40) faz o INSERT do evento falhar sob MySQL estrito →
    // a transação inteira (CAS + evento) sofre rollback. Sem framework de injeção; caminho de produção.
    const eventTypeLongoDemais = "e".repeat(60);
    await expect(
      applyGovernedItemTransition({
        itemId: item.id, orgId: ORG, target: "aprovado", approvedBy: USER,
        actorUserId: USER, correlationId: "corr-rollback", eventType: eventTypeLongoDemais,
        summary: (d) => `Item aprovado: ${d}.`,
      }),
    ).rejects.toBeTruthy(); // falha inesperada de persistência propaga

    // O CAS foi revertido: o item permanece no estado anterior e NÃO há evento órfão.
    const afterFail = await getIntelligentItem(item.id, ORG);
    expect(afterFail?.status).toBe("pendente");
    expect((await listProcessTimeline("proc-rollback", ORG)).length).toBe(0);

    // Nova tentativa VÁLIDA aplica normalmente: estado → aprovado, exatamente um evento.
    const ok = await applyGovernedItemTransition({
      itemId: item.id, orgId: ORG, target: "aprovado", approvedBy: USER,
      actorUserId: USER, correlationId: "corr-rollback-2", eventType: "approval",
      summary: (d) => `Item aprovado: ${d}.`,
    });
    expect(ok.status).toBe("aprovado");
    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("aprovado");
    const approvals = (await listProcessTimeline("proc-rollback", ORG)).filter((e) => e.eventType === "approval" && e.refId === item.id);
    expect(approvals.length).toBe(1);
  }, 60_000);

  it("isolamento multi-tenant: CAS de outro tenant não afeta o item", async () => {
    const item = await seedPendingItem("proc-tenant", ORG);
    // Tenta transicionar o MESMO id sob outra org → 0 linhas (escopo por organization_id).
    const res = await transitionItemStatusCAS({
      id: item.id, orgId: ORG_OTHER, fromStatuses: itemTransitionSources("aprovado"),
      toStatus: "aprovado", approvedBy: USER, updatedAt: new Date().toISOString(),
    });
    expect(res.applied).toBe(false);
    const fresh = await getIntelligentItem(item.id, ORG);
    expect(fresh?.status).toBe("pendente"); // intacto
  }, 60_000);
});
