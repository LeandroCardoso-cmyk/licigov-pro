/**
 * R9 / SEM-052 + SEM-054 — Itens Inteligentes: aplicar cotações atualizadas só com confirmação (token) e
 * aprovação bloqueada com fonte não vigente. MySQL 8 real, appRouter real, dados sintéticos (órgãos 960520/960521).
 *
 *   A1. item APROVADO + nova pesquisa ⇒ source_changed; "Aprovar" (router) ⇒ PRECONDITION_FAILED ITEM_SOURCE_CHANGED,
 *       nada muda (status, média, approved_by), sem evento de aprovação;
 *   A2. prévia (router): atual × proposto em centavos + revogação declarada + token;
 *   A3. confirmação STALE (a pesquisa mudou depois da prévia) ⇒ CONFLICT SOURCE_UPDATE_STALE, nada aplicado;
 *   A4. confirmação com o token da prévia vigente ⇒ aplica exatamente o mostrado (em_analise, média nova, approved_by
 *       nulo, evento com a revogação); repetir ⇒ replay idempotente (sem novo evento); token antigo ⇒ PRECONDITION_FAILED;
 *       depois disso "Aprovar" passa;
 *   A5. identidade ambígua (review_required) ⇒ "Aprovar" recusado (ITEM_IDENTITY_REVIEW_REQUIRED); após a resolução
 *       humana (`resolveItemIdentity`) a aprovação passa;
 *   A6. CAS condicionado: fonte não vigente faz o CAS perder (corrida com a materialização);
 *   A7. listItems traz outliers em centavos (limite >50% estrito); outro órgão ⇒ NOT_FOUND na prévia/aplicação.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { importManualPriceResearch, resolveItemIdentity } from "../../services/itemMaterializationService";
import { insertProcess, listIntelligentItems, listProcessTimeline, transitionItemStatusCAS } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";

const DB = process.env.DATABASE_URL;
const ORG = 960520;
const ORG_B = 960521;

describe.skipIf(!DB)("R9 / SEM-052 + SEM-054 — confirmação de cotações e portão de aprovação (MySQL 8)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let operator = 0, operatorB = 0, seq = 0;

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `sem052-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "ERR", message: String(x.message ?? "") }; }
  }
  async function newProcess(): Promise<string> {
    const p = createProcurementWorkspace({ organizationId: ORG, processNumber: `S52-${stamp}-${++seq}`, object: "Material", startOption: "iniciar_pesquisa", responsibleUser: operator, correlationId: "sem052" });
    await insertProcess(p);
    return p.id;
  }
  const manual = (pid: string, text: string) =>
    importManualPriceResearch({ organizationId: ORG, processId: pid, source: "colar", text, actorUserId: operator, correlationId: `m-${++seq}` });
  async function row(id: string) {
    const [r] = await conn.execute<mysql.RowDataPacket[]>("SELECT status, approved_by, average_price, source_state, pending_suppliers FROM intelligent_items WHERE id = ?", [id]);
    const x = r[0] as { status: string; approved_by: number | null; average_price: string; source_state: string; pending_suppliers: string | null };
    return { status: x.status, approvedBy: x.approved_by, averagePrice: String(x.average_price), sourceState: x.source_state, hasPending: x.pending_suppliers !== null };
  }
  async function cleanup() {
    for (const t of ["price_research_items", "price_research", "intelligent_item_identity_aliases", "item_catmat_matches", "item_risks",
      "item_recommendations", "intelligent_items", "process_timeline", "procurement_processes"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
    }
    for (const t of ["catmat_decisions", "organization_members", "idempotency_keys"]) await conn.query(`DELETE FROM \`${t}\` WHERE organizationId IN (?, ?)`, [ORG, ORG_B]).catch(() => {});
  }
  const legacyId = (pid: string, desc: string) => createHash("sha256").update(`iitem:${ORG}:${pid}:${desc.toLowerCase().trim()}`).digest("hex").slice(0, 20);
  async function insertLegacyItem(pid: string, p: { description: string; unit: string; quantity: number; status: string; value: number }) {
    const id = legacyId(pid, p.description);
    await conn.execute(
      `INSERT INTO intelligent_items (id, organization_id, process_id, source_research_id, description, quantity, unit, average_price, suppliers,
         suggested_catmat, alternative_catmat, specifications, risks, recommendations, status, approved_by, enrichment_status, correlation_id)
       VALUES (?, ?, ?, 'legacy-r', ?, ?, ?, ?, ?, NULL, '[]', '[]', '[]', '[]', ?, NULL, 'done', 'legacy')`,
      [id, ORG, pid, p.description, p.quantity, p.unit, p.value.toFixed(2), JSON.stringify([{ name: "Fornecedor legado", value: p.value }]), p.status],
    );
    return id;
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await cleanup();
    for (const id of [ORG, ORG_B]) await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `SEM052 ${id}`, `sem052-${id}`]);
    const mk = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`sem052-${tag}-${stamp}`, tag, `sem052-${tag}-${stamp}@teste.local`]))[0].insertId;
    operator = await mk("operator");
    operatorB = await mk("operatorb");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, operator]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG_B, operatorB]);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE id IN (?, ?)", [operator, operatorB]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("A1–A4) aprovar com fonte alterada é recusado; prévia + token; confirmação stale ⇒ CONFLICT; token vigente aplica; replay idempotente", async () => {
    const c = await caller(operator, ORG);
    const pid = await newProcess();
    await manual(pid, "Papel A4;10;resma;R$ 100,00;Papelaria X");
    const [it] = await listIntelligentItems(pid, ORG);
    await c.procurementProcess.approveItem({ itemId: it.id });
    expect((await row(it.id)).status).toBe("aprovado");

    // A1 — nova pesquisa após a decisão ⇒ source_changed; aprovar é recusado, nada muda.
    await manual(pid, "Papel A4;10;resma;R$ 300,00;Papelaria X");
    const before = await row(it.id);
    expect(before).toMatchObject({ status: "aprovado", approvedBy: operator, averagePrice: "100.00", sourceState: "source_changed", hasPending: true });
    const approvalEvents = async () => (await listProcessTimeline(pid, ORG)).filter((e) => e.summary.startsWith("Item aprovado")).length;
    const evBefore = await approvalEvents();
    const refused = await err(c.procurementProcess.approveItem({ itemId: it.id }));
    expect(refused?.code).toBe("PRECONDITION_FAILED");
    expect(refused?.message).toMatch(/^ITEM_SOURCE_CHANGED: /);
    expect(await row(it.id)).toEqual(before);
    expect(await approvalEvents()).toBe(evBefore);

    // A2 — prévia pelo router.
    const p1 = await c.procurementProcess.previewItemSourceUpdate({ itemId: it.id });
    expect(p1).toMatchObject({
      itemId: it.id, status: "aprovado", revokesDecision: "aprovado", statusAfter: "em_analise",
      current: { quoteCount: 1, averageCents: 10000 }, proposed: { quoteCount: 1, averageCents: 30000 }, averageDeltaCents: 20000,
    });
    expect(p1.changed).toEqual([expect.objectContaining({ beforeCents: 10000, afterCents: 30000 })]);

    // A3 — a pesquisa muda DEPOIS da prévia: a confirmação antiga é stale ⇒ CONFLICT, nada aplicado.
    await manual(pid, "Papel A4;10;resma;R$ 350,00;Papelaria X");
    const stale = await err(c.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: p1.expectedStateToken }));
    expect(stale?.code).toBe("CONFLICT");
    expect(stale?.message).toMatch(/^SOURCE_UPDATE_STALE: /);
    expect(await row(it.id)).toMatchObject({ status: "aprovado", approvedBy: operator, averagePrice: "100.00", sourceState: "source_changed" });
    // Token mal-formado também não aplica.
    expect((await err(c.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: "forjado" })))?.code).toBe("BAD_REQUEST");

    // A4 — nova prévia (o que o usuário vê agora) e confirmação com o token dela.
    const p2 = await c.procurementProcess.previewItemSourceUpdate({ itemId: it.id });
    expect(p2.proposed.averageCents).toBe(35000);
    expect(p2.expectedStateToken).not.toBe(p1.expectedStateToken);
    const applied = await c.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: p2.expectedStateToken });
    expect(applied).toMatchObject({ status: "em_analise", averageCents: 35000, quoteCount: 1, replayed: false });
    expect(await row(it.id)).toMatchObject({ status: "em_analise", approvedBy: null, averagePrice: "350.00", sourceState: "current", hasPending: false });
    const applyEvents = async () => (await listProcessTimeline(pid, ORG)).filter((e) => e.summary.startsWith("Cotações atualizadas aplicadas"));
    const ev = await applyEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toContain("R$ 100,00→R$ 350,00");
    expect(ev[0].summary).toContain("revogada");

    // Replay da MESMA confirmação: idempotente, sem novo efeito nem evento.
    const replay = await c.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: p2.expectedStateToken });
    expect(replay).toMatchObject({ status: "em_analise", averageCents: 35000, replayed: true });
    expect(await applyEvents()).toHaveLength(1);
    // Confirmação antiga (outro alvo) não é replay: não há mais atualização pendente.
    expect((await err(c.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: p1.expectedStateToken })))?.code).toBe("PRECONDITION_FAILED");

    // Fonte vigente de novo ⇒ aprovação humana sobre os números NOVOS passa.
    await c.procurementProcess.approveItem({ itemId: it.id });
    expect(await row(it.id)).toMatchObject({ status: "aprovado", approvedBy: operator, averagePrice: "350.00" });
  }, 120_000);

  it("A5) identidade a revisar ⇒ aprovar recusado (ITEM_IDENTITY_REVIEW_REQUIRED); após resolução humana passa", async () => {
    const c = await caller(operator, ORG);
    const pid = await newProcess();
    const t1 = await insertLegacyItem(pid, { description: "Toner  HP", unit: "un", quantity: 2, status: "pendente", value: 40 });
    const t2 = await insertLegacyItem(pid, { description: "Toner HP.", unit: "un", quantity: 2, status: "pendente", value: 45 });
    const r = await manual(pid, "Toner HP;2;un;R$ 50,00;X");
    expect(r.result.reviewRequired).toHaveLength(1);
    expect((await row(t1)).sourceState).toBe("review_required");
    const refused = await err(c.procurementProcess.approveItem({ itemId: t1 }));
    expect(refused?.code).toBe("PRECONDITION_FAILED");
    expect(refused?.message).toMatch(/^ITEM_IDENTITY_REVIEW_REQUIRED: /);
    // O caminho alternativo (itemIntelligence.approveItem) está DESLIGADO neste branch (SEM-026, LEGACY_ENDPOINT_DISABLED):
    // nenhuma aprovação passa por ele — o portão da aprovação canônica é o único caminho.
    expect((await err(c.itemIntelligence.approveItem({ itemId: t2 })))?.message).toMatch(/ITEM_IDENTITY_REVIEW_REQUIRED|LEGACY_ENDPOINT_DISABLED/);
    expect((await row(t1)).status).toBe("pendente");

    await resolveItemIdentity({ organizationId: ORG, processId: pid, logicalKeyHash: r.result.reviewRequired[0], targetItemId: t1, actorUserId: operator, reason: "É o mesmo toner do legado", correlationId: "res" });
    expect((await row(t1)).sourceState).toBe("current");
    await c.procurementProcess.approveItem({ itemId: t1 });
    expect((await row(t1)).status).toBe("aprovado");
  }, 120_000);

  it("A6) CAS condicionado a source_state='current': fonte não vigente faz a aprovação perder o CAS", async () => {
    const pid = await newProcess();
    await manual(pid, "Grampeador;3;un;R$ 55,00;X");
    const [it] = await listIntelligentItems(pid, ORG);
    await conn.execute("UPDATE intelligent_items SET source_state = 'source_changed' WHERE id = ?", [it.id]);
    const cas = (requireSourceState?: string) => transitionItemStatusCAS({ id: it.id, orgId: ORG, fromStatuses: ["pendente", "em_analise"], toStatus: "aprovado", approvedBy: operator, updatedAt: new Date().toISOString(), requireSourceState });
    expect((await cas("current")).applied).toBe(false);
    expect((await row(it.id)).status).toBe("pendente");
    await conn.execute("UPDATE intelligent_items SET source_state = 'current' WHERE id = ?", [it.id]);
    expect((await cas("current")).applied).toBe(true);
  }, 60_000);

  it("A7) listItems traz outliers em centavos (>50% estrito); outro órgão ⇒ NOT_FOUND na prévia e na aplicação", async () => {
    const c = await caller(operator, ORG);
    const pid = await newProcess();
    await manual(pid, "Cadeira;10;un;R$ 100,00;A\nCadeira;10;un;R$ 100,00;B\nCadeira;10;un;R$ 400,00;C");
    const { items } = await c.procurementProcess.listItems({ processId: pid });
    expect(items[0].averagePriceCents).toBe(20000);
    expect(items[0].priceOutliers).toEqual([{ name: "C", valueCents: 40000, deviationPercent: 100 }]);

    const [it] = await listIntelligentItems(pid, ORG);
    await c.procurementProcess.approveItem({ itemId: it.id });
    await manual(pid, "Cadeira;10;un;R$ 100,00;A\nCadeira;10;un;R$ 100,00;B\nCadeira;10;un;R$ 130,00;C");
    const p = await c.procurementProcess.previewItemSourceUpdate({ itemId: it.id });
    const b = await caller(operatorB, ORG_B);
    expect((await err(b.procurementProcess.previewItemSourceUpdate({ itemId: it.id })))?.code).toBe("NOT_FOUND");
    expect((await err(b.procurementProcess.applyItemSourceUpdate({ itemId: it.id, expectedStateToken: p.expectedStateToken })))?.code).toBe("NOT_FOUND");
    expect((await row(it.id)).status).toBe("aprovado");
  }, 60_000);
});
