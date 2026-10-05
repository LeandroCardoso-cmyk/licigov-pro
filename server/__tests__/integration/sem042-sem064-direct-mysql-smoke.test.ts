/**
 * R9 / SEM-042 + SEM-064 — Contratação Direta contra MySQL REAL, pelo ROUTER real (appRouter.createCaller; tenant
 * resolvido por organization_members; RBAC real). Só roda com DATABASE_URL.
 *
 * SEM-042 (linhagem do preço; sem sucesso falso):
 *  - `characterizeNeed`/`importDFD` recusam com NOT_IMPLEMENTED estável e ZERO efeito (linhas, timeline, IA);
 *  - justificativa por "pesquisa": valor CALCULADO pelo servidor (método escolhido pela pessoa), proposta do cliente só
 *    comparada (divergência ⇒ recusa); linhagem (id da pesquisa, contentHash, nº de cotações, método, valor) gravada;
 *    sem "Baseado na Pesquisa…/confiança 0,85"; pesquisa ausente/ambígua/adulterada/de outro órgão ⇒ recusa sem escrita;
 *    manual/documento ⇒ valor DECLARADO, sem pesquisa vinculada; token de linhagem forjado pelo cliente ⇒ recusa;
 *  - evento de timeline único, ator humano (`user:<id>`), correlationId, refId.
 * SEM-064 (status dos atos registrados):
 *  - ponteiro de etapa/status "ratificado"/"publicado" SEM ato registrado ⇒ status exibido NÃO afirma o ato;
 *  - ratificação no ledger ⇒ "ratificado"; publicações gravadas + ratificação ⇒ "publicado"; decisão superveniente "não
 *    ratificado" ⇒ "publicado" some (sem novo vocabulário — HD-09);
 *  - `configureFlags` deixa evento (antes→depois, ator humano, correlationId), no-op não escreve, não toca etapa/status;
 *  - `publish` não gera extrato de contrato inexistente: opt-in + contrato registrado vinculado, senão recusa estável
 *    com zero escritas; contrato de outro órgão / minuta não conta; replay não duplica o evento.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

vi.mock("../../services/aiExecutionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/aiExecutionEngine")>();
  return { ...actual, executeCognitiveTask: vi.fn(actual.executeCognitiveTask) };
});
vi.mock("../../services/workspaceOrchestratorService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/workspaceOrchestratorService")>();
  return { ...actual, orchestrateMultiCopilot: vi.fn(actual.orchestrateMultiCopilot) };
});

import * as aiEngine from "../../services/aiExecutionEngine";
import * as orchestrator from "../../services/workspaceOrchestratorService";

const DB = process.env.DATABASE_URL;
const ORG_A = 960601;
const ORG_B = 960602;

const ORG_TABLES = [
  "direct_procurement_workspaces", "direct_procurement_procedures", "proposal_collections", "proposal_documents",
  "contract_justifications", "price_justifications", "required_documents", "ratifications", "generated_publications",
  "price_research", "price_research_items", "process_timeline", "institutional_requests", "request_assignments",
  "request_timelines", "request_notifications", "ai_execution_audits", "institutional_decisions", "contract_workspaces",
] as const;

describe.skipIf(!DB)("SEM-042 / SEM-064 — Contratação Direta (MySQL real, pelo router)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let manager: number, operator: number, viewer: number, foreignManager: number;
  let allUsers: number[] = [];

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A SEM042 ${stamp}`, `org-a-sem042-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B SEM042 ${stamp}`, `org-b-sem042-${stamp}`]);
    const user = async (tag: string): Promise<number> => {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`sem042-${tag}-${stamp}`, `SEM042 ${tag}`, `sem042-${tag}-${stamp}@teste.local`]);
      return r.insertId;
    };
    const member = (org: number, userId: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    manager = await user("manager"); operator = await user("operator"); viewer = await user("viewer"); foreignManager = await user("fmanager");
    allUsers = [manager, operator, viewer, foreignManager];
    await member(ORG_A, manager, "manager"); await member(ORG_A, operator, "operator"); await member(ORG_A, viewer, "viewer");
    await member(ORG_B, foreignManager, "manager");
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, params: unknown[]) => { await conn.execute(sql, params).catch(() => {}); };
    for (const t of ORG_TABLES) await del(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]);
    const inUsers = allUsers.map(() => "?").join(",");
    if (allUsers.length) {
      await del(`DELETE FROM notifications WHERE userId IN (${inUsers})`, allUsers);
      await del(`DELETE FROM audit_logs WHERE adminId IN (${inUsers})`, allUsers);
    }
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    if (allUsers.length) await del(`DELETE FROM users WHERE id IN (${inUsers})`, allUsers);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, correlationId = `sem042-${userId}-${stamp}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  const rows = async (sql: string, params: unknown[]) => {
    const [r] = await conn.execute<mysql.RowDataPacket[]>(sql, params);
    return r;
  };
  const one = async (sql: string, params: unknown[]) => (await rows(sql, params))[0];

  /** Contagem de TODAS as tabelas do domínio + documentos oficiais (prova de ausência de efeito). */
  async function snapshot(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ORG_TABLES) out[t] = Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B])).n);
    out.official_documents = Number((await one(`SELECT COUNT(*) n FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B])).n);
    return out;
  }
  const aiCalls = () => vi.mocked(aiEngine.executeCognitiveTask).mock.calls.length + vi.mocked(orchestrator.orchestrateMultiCopilot).mock.calls.length;
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "?", message: x.message ?? "" }; }
    return { code: "RESOLVED", message: "" };
  };
  /** Recusa com código/token estável E zero efeito (linhas, timeline, documentos, IA). */
  async function expectRefused(label: string, fn: () => Promise<unknown>, code: string, token: string | RegExp) {
    const before = await snapshot(); const ai = aiCalls();
    const e = await errOf(fn);
    expect(e.code, `${label}: ${e.message}`).toBe(code);
    expect(e.message, label).toMatch(token);
    expect(await snapshot(), `${label} — efeitos`).toEqual(before);
    expect(aiCalls(), `${label} — IA`).toBe(ai);
  }

  let seq = 0;
  async function newWorkspace(org = ORG_A, userId = manager): Promise<string> {
    const c = await caller(userId, org);
    const r = await c.directProcurement.createProcess({ processNumber: `SEM042-${stamp}/${++seq}`, object: "Aquisição de notebooks", procurementType: "dispensa", startOption: "sem_dfd" });
    return r.workspace.id;
  }
  const QUOTES = "Notebook;1;un;14000;Forn A\nNotebook;1;un;15000;Forn B\nNotebook;1;un;16500;Forn C";
  const importQuotes = async (wsId: string, text = QUOTES, key = `imp-${stamp}-${++seq}`) =>
    (await caller(operator, ORG_A)).directProcurement.importPriceResearch({ workspaceId: wsId, source: "colar", text, idempotencyKey: key });
  const GOOD = "Preço fundamentado nas cotações obtidas no mercado local.";

  // ─── SEM-042 (b) — nada de sucesso falso ────────────────────────────────────

  it("S42-1) characterizeNeed / importDFD recusam com NOT_IMPLEMENTED estável — ZERO efeito; RBAC e tenant intactos", async () => {
    const wsId = await newWorkspace();
    const op = await caller(operator, ORG_A);
    await expectRefused("characterizeNeed", () => op.directProcurement.characterizeNeed({ workspaceId: wsId, description: "Necessidade X", estimatedValue: 100 }), "NOT_IMPLEMENTED", /DIRECT_NEED_NOT_PERSISTED/);
    await expectRefused("importDFD", () => op.directProcurement.importDFD({ workspaceId: wsId, source: "pdf", fields: { objeto: "x" } }), "NOT_IMPLEMENTED", /DIRECT_DFD_IMPORT_NOT_PERSISTED/);
    // viewer: barrado pelo RBAC ANTES (piso operator), sem efeito
    const v = await caller(viewer, ORG_A);
    await expectRefused("viewer characterizeNeed", () => v.directProcurement.characterizeNeed({ workspaceId: wsId, description: "x" }), "FORBIDDEN", /papel mínimo 'operator'/);
    // outro órgão: NOT_FOUND neutro (nunca a recusa de "não persistido" — sem vazar existência)
    const fm = await caller(foreignManager, ORG_B);
    await expectRefused("foreign characterizeNeed", () => fm.directProcurement.characterizeNeed({ workspaceId: wsId, description: "x" }), "NOT_FOUND", /não encontrado nesta organização/);
    await expectRefused("foreign importDFD", () => fm.directProcurement.importDFD({ workspaceId: wsId, source: "pdf" }), "NOT_FOUND", /não encontrado nesta organização/);
  }, 120_000);

  // ─── SEM-042 (a) — linhagem do valor do preço ───────────────────────────────

  it("S42-2) pesquisa: valor CALCULADO pelo servidor + linhagem gravada; evento único, ator humano; sem boilerplate fixo", async () => {
    const wsId = await newWorkspace();
    const imp = await importQuotes(wsId);
    const op = await caller(operator, ORG_A, "corr-s42-2");

    // leitura: o servidor calcula as estatísticas (o cliente só exibe)
    const read = await op.directProcurement.getJustifications({ workspaceId: wsId });
    expect(read.priceResearches).toHaveLength(1);
    expect(read.priceResearches[0]).toMatchObject({ researchId: imp.researchId, contentHash: imp.contentHash, quoteCount: 3, consistent: true });
    expect(read.priceResearches[0].values).toEqual({ media: 15166.67, mediana: 15000, menor_preco: 14000 });

    const tl0 = Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ?`, [wsId, ORG_A])).n);
    // sem referenceValue do cliente: vale o do servidor (menor preço)
    const out = await op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "pesquisa", justification: GOOD, method: "menor_preco", confirmOfficial: true });
    expect(out.priceJustification?.referenceValue).toBe(14000);
    expect(out.lineage).toMatchObject({ kind: "pesquisa", researchId: imp.researchId, contentHash: imp.contentHash, quoteCount: 3, method: "menor_preco", computedValue: 14000, proposedValue: null });
    expect(JSON.stringify(out)).not.toMatch(/confian|recommendation|Baseado na Pesquisa/i);

    const row = await one(`SELECT reference_value, research_id, document_references, source FROM price_justifications WHERE workspace_id = ? AND organization_id = ?`, [wsId, ORG_A]);
    expect(Number(row.reference_value)).toBe(14000);
    expect(row.research_id).toBe(imp.researchId);
    expect(String(row.document_references)).toContain(imp.contentHash);

    // leitura persistida devolve a linhagem estruturada
    const persisted = (await op.directProcurement.getJustifications({ workspaceId: wsId })).price;
    expect(persisted?.lineage).toMatchObject({ kind: "pesquisa", researchId: imp.researchId, method: "menor_preco" });
    expect(persisted?.documentReferences).toEqual([]); // o token reservado não vaza como "referência"

    // evento ÚNICO, ator humano, correlationId, refId = id da justificativa; resumo factual
    const evs = await rows(`SELECT id, actor, summary, correlation_id, ref_id, event_type FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Justificativa do preço registrada%'`, [wsId, ORG_A]);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ actor: `user:${operator}`, correlation_id: "corr-s42-2", ref_id: persisted?.id, event_type: "change" });
    expect(String(evs[0].summary)).toContain(imp.researchId);
    expect(String(evs[0].summary)).toContain(imp.contentHash.slice(0, 12));
    expect(String(evs[0].summary)).not.toMatch(/confian/i);
    expect(Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ?`, [wsId, ORG_A])).n)).toBe(tl0 + 1);

    // documento oficial: origem do valor explícita
    const doc = await one(`SELECT content FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'justificativa_preco'`, [ORG_A, wsId]);
    expect(String(doc.content)).toContain(imp.researchId);
    expect(String(doc.content)).toContain("Origem do valor");
    expect(String(doc.content)).not.toMatch(/confian|Baseado na Pesquisa/i);

    // proposta do cliente IGUAL ao valor do servidor é aceita (e registrada como proposta); média arredondada em centavos
    const out2 = await op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "pesquisa", justification: GOOD, method: "media", referenceValue: 15166.67, researchId: imp.researchId, confirmOfficial: true });
    expect(out2.priceJustification?.referenceValue).toBe(15166.67);
    expect(out2.lineage).toMatchObject({ method: "media", computedValue: 15166.67, proposedValue: 15166.67 });
  }, 120_000);

  it("S42-3) recusas SEM escrita: sem método, valor divergente, sem pesquisa, token forjado, researchId com manual, sem aceite", async () => {
    const wsId = await newWorkspace();
    const op = await caller(operator, ORG_A);
    const base = { workspaceId: wsId, justification: GOOD, confirmOfficial: true as const };

    await expectRefused("sem pesquisa", () => op.directProcurement.generatePriceJustification({ ...base, source: "pesquisa", method: "media" }), "PRECONDITION_FAILED", /PRICE_RESEARCH_REQUIRED/);
    const imp = await importQuotes(wsId);
    await expectRefused("sem método", () => op.directProcurement.generatePriceJustification({ ...base, source: "pesquisa", researchId: imp.researchId }), "BAD_REQUEST", /PRICE_METHOD_REQUIRED/);
    await expectRefused("valor do cliente diverge", () => op.directProcurement.generatePriceJustification({ ...base, source: "pesquisa", method: "mediana", referenceValue: 99999, researchId: imp.researchId }), "PRECONDITION_FAILED", /PRICE_REFERENCE_DIVERGES/);
    await expectRefused("token de linhagem forjado", () => op.directProcurement.generatePriceJustification({ ...base, source: "manual", referenceValue: 10, documentReferences: ['price-lineage/v1:{"kind":"pesquisa"}'] }), "BAD_REQUEST", /PRICE_LINEAGE_NOT_ALLOWED/);
    await expectRefused("researchId com fonte manual", () => op.directProcurement.generatePriceJustification({ ...base, source: "manual", referenceValue: 10, researchId: imp.researchId }), "BAD_REQUEST", /PRICE_LINEAGE_NOT_ALLOWED/);
    await expectRefused("pesquisa inexistente", () => op.directProcurement.generatePriceJustification({ ...base, source: "pesquisa", method: "media", researchId: "nao-existe-0000" }), "NOT_FOUND", /PRICE_RESEARCH_NOT_FOUND/);
    await expectRefused("sem aceite humano", () => op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "pesquisa", justification: GOOD, method: "media", researchId: imp.researchId }), "PRECONDITION_FAILED", /HUMAN_APPROVAL_REQUIRED/);
    expect(Number((await one(`SELECT COUNT(*) n FROM price_justifications WHERE workspace_id = ?`, [wsId])).n)).toBe(0);
  }, 120_000);

  it("S42-4) pesquisa ambígua exige escolha; adulterada ⇒ INTEGRIDADE; inconsistente ⇒ recusa; legada não conta", async () => {
    const wsId = await newWorkspace();
    const op = await caller(operator, ORG_A);
    const a = await importQuotes(wsId);
    const b = await importQuotes(wsId, "Mouse;2;un;50;Forn A\nMouse;2;un;70;Forn B");
    const args = { workspaceId: wsId, source: "pesquisa" as const, justification: GOOD, method: "media" as const, confirmOfficial: true as const };
    await expectRefused("ambígua", () => op.directProcurement.generatePriceJustification(args), "PRECONDITION_FAILED", /PRICE_RESEARCH_AMBIGUOUS/);
    const ok = await op.directProcurement.generatePriceJustification({ ...args, researchId: b.researchId });
    expect(ok.priceJustification?.referenceValue).toBe(120); // 2 un × média(50,70)
    expect(ok.lineage).toMatchObject({ researchId: b.researchId, quoteCount: 2 });

    // adulteração das cotações persistidas ⇒ contentHash recomputado ≠ id ⇒ INTEGRIDADE (e some da lista verificada)
    await conn.execute(`UPDATE price_research_items SET value = 1 WHERE research_id = ? AND organization_id = ? LIMIT 1`, [a.researchId, ORG_A]);
    await expectRefused("adulterada", () => op.directProcurement.generatePriceJustification({ ...args, researchId: a.researchId }), "PRECONDITION_FAILED", /PRICE_RESEARCH_INTEGRITY/);
    expect((await op.directProcurement.getJustifications({ workspaceId: wsId })).priceResearches.map((r) => r.researchId)).toEqual([b.researchId]);

    // linha LEGADA (id fora da derivação governada) no mesmo workspace: não é lastro — nunca listada, recusada se citada
    await conn.execute(`INSERT INTO price_research (id, organization_id, process_id, source, item_count, correlation_id) VALUES ('prwlegacy0000000001', ?, ?, 'colar', 1, 'legacy')`, [ORG_A, wsId]);
    await conn.execute(`INSERT INTO price_research_items (id, organization_id, research_id, process_id, description, quantity, unit, supplier, brand, model, value, observations, source) VALUES ('priLegacy000000001', ?, 'prwlegacy0000000001', ?, 'X', 1, 'un', '', '', '', 5, '', 'colar')`, [ORG_A, wsId]);
    expect((await op.directProcurement.getJustifications({ workspaceId: wsId })).priceResearches.map((r) => r.researchId)).toEqual([b.researchId]);
    await expectRefused("legada", () => op.directProcurement.generatePriceJustification({ ...args, researchId: "prwlegacy0000000001" }), "PRECONDITION_FAILED", /PRICE_RESEARCH_INTEGRITY/);

    // quantidades divergentes para o MESMO item ⇒ pesquisa inconsistente (nunca escolhe uma quantidade)
    const w2 = await newWorkspace();
    const inc = await importQuotes(w2, "Caneta;100;un;1,50;F1\nCaneta;200;un;1,40;F2");
    await expectRefused("inconsistente", () => op.directProcurement.generatePriceJustification({ ...args, workspaceId: w2, researchId: inc.researchId }), "PRECONDITION_FAILED", /PRICE_RESEARCH_INCONSISTENT/);
  }, 120_000);

  it("S42-5) tenant: pesquisa/justificativa de outro órgão ⇒ NOT_FOUND neutro, zero escrita; leitura isolada", async () => {
    const wsA = await newWorkspace(ORG_A, manager);
    const impA = await importQuotes(wsA);
    const wsB = await newWorkspace(ORG_B, foreignManager);
    const fm = await caller(foreignManager, ORG_B);
    // (1) workspace de A via órgão B
    await expectRefused("foreign → ws de A", () => fm.directProcurement.generatePriceJustification({ workspaceId: wsA, source: "pesquisa", justification: GOOD, method: "media", researchId: impA.researchId, confirmOfficial: true }), "NOT_FOUND", /não encontrado nesta organização/);
    // (2) workspace de B citando a pesquisa de A ⇒ não existe no órgão B
    await expectRefused("ws de B com researchId de A", () => fm.directProcurement.generatePriceJustification({ workspaceId: wsB, source: "pesquisa", justification: GOOD, method: "media", researchId: impA.researchId, confirmOfficial: true }), "NOT_FOUND", /PRICE_RESEARCH_NOT_FOUND/);
    await expect(fm.directProcurement.getJustifications({ workspaceId: wsA })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fm.directProcurement.getJustifications({ workspaceId: wsB })).priceResearches).toEqual([]);
  }, 120_000);

  it("S42-6) manual/documento: valor DECLARADO, sem pesquisa vinculada (nada de 'baseado na pesquisa')", async () => {
    const wsId = await newWorkspace();
    const op = await caller(operator, ORG_A);
    const out = await op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "manual", justification: GOOD, referenceValue: 321.5, documentReferences: ["Proposta 12/2026"], confirmOfficial: true });
    expect(out.lineage).toEqual({ kind: "declarado", declaredValue: 321.5, declaredByUserId: operator });
    const persisted = (await op.directProcurement.getJustifications({ workspaceId: wsId })).price;
    expect(persisted).toMatchObject({ source: "manual", referenceValue: 321.5, researchId: "", documentReferences: ["Proposta 12/2026"] });
    expect(persisted?.lineage?.kind).toBe("declarado");
    // valor ≤ 0 em fonte manual ⇒ recusa sem escrita
    await expectRefused("manual sem valor", () => op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "manual", justification: GOOD, confirmOfficial: true }), "BAD_REQUEST", /JUSTIFICATION_FIELDS_REQUIRED/);
  }, 120_000);

  // ─── SEM-064 — status dos ATOS REGISTRADOS ──────────────────────────────────

  async function validatedChecklist(wsId: string) {
    await (await caller(manager, ORG_A)).directProcurement.validateDocuments({ workspaceId: wsId });
    await conn.execute(
      "UPDATE required_documents SET status = 'validado', content_hash = REPEAT('a', 64), document_reference = CONCAT('contratacao_direta/', workspace_id, '/1-doc.pdf') WHERE workspace_id = ? AND organization_id = ?",
      [wsId, ORG_A]);
  }
  let rk = 0;
  const ratify = async (wsId: string, decision: "ratificado" | "nao_ratificado", expectedRevision: number) =>
    (await caller(manager, ORG_A)).directProcurement.ratify({
      workspaceId: wsId, decision, decidedByName: "Autoridade SEM064", decidedByRole: "Secretário(a)", decidedAt: "2026-09-30",
      basisReference: "Despacho SEM064/2026", justification: "Registro SEM064 (teste).", expectedRevision, idempotencyKey: `sem064-rat-${stamp}-${++rk}`,
    });
  const statusOf = async (wsId: string, org = ORG_A, userId = manager) => {
    const c = await caller(userId, org);
    const loaded = await c.directProcurement.loadProcess({ workspaceId: wsId });
    const listed = (await c.directProcurement.listProcesses({ limit: 100 })).workspaces.find((w) => w.id === wsId);
    return { loaded, listed };
  };

  it("S64-1) ponteiro 'ratificado'/'publicado' SEM ato registrado ⇒ o status exibido NÃO afirma o ato (e diz isso)", async () => {
    const wsId = await newWorkspace();
    // legado/ponteiro: etapa PUBLICATION + status 'publicado' gravados SEM decisão no ledger e SEM publicações
    await conn.execute(`UPDATE direct_procurement_workspaces SET current_stage = 'PUBLICATION', status = 'publicado' WHERE id = ? AND organization_id = ?`, [wsId, ORG_A]);
    const { loaded, listed } = await statusOf(wsId);
    expect(loaded.workspace?.status).toBe("em_andamento");
    expect(loaded.statusBasis).toMatchObject({ ratification: "NO_RECORDED_ACT", publication: "NO_RECORDED_ACT", unsupportedPointerClaims: ["publicado"], storedStatus: "publicado" });
    expect(listed).toMatchObject({ status: "em_andamento", storedStatus: "publicado", ratificationBasis: "NO_RECORDED_ACT", publicationBasis: "NO_RECORDED_ACT" });

    await conn.execute(`UPDATE direct_procurement_workspaces SET current_stage = 'RATIFICATION', status = 'ratificado' WHERE id = ? AND organization_id = ?`, [wsId, ORG_A]);
    expect((await statusOf(wsId)).loaded.workspace?.status).toBe("em_andamento");
    expect((await statusOf(wsId)).loaded.statusBasis?.unsupportedPointerClaims).toEqual(["ratificado"]);
  }, 120_000);

  it("S64-2) ratificação no ledger ⇒ 'ratificado'; publicações + ratificação ⇒ 'publicado'; superveniente 'não ratificado' ⇒ não afirma 'publicado'", async () => {
    const wsId = await newWorkspace();
    expect((await statusOf(wsId)).loaded.workspace?.status).toBe("rascunho");

    await ratify(wsId, "ratificado", 0);
    let s = await statusOf(wsId);
    expect(s.loaded.workspace?.status).toBe("ratificado");
    expect(s.loaded.statusBasis).toMatchObject({ ratification: "RECORDED_RATIFIED", publication: "NO_RECORDED_ACT", unsupportedPointerClaims: [] });
    expect(s.listed?.status).toBe("ratificado");

    await validatedChecklist(wsId);
    await (await caller(manager, ORG_A)).directProcurement.publish({ workspaceId: wsId });
    s = await statusOf(wsId);
    expect(s.loaded.workspace?.status).toBe("publicado");
    expect(s.loaded.statusBasis).toMatchObject({ ratification: "RECORDED_RATIFIED", publication: "RECORDED", unsupportedPointerClaims: [] });
    expect(s.listed?.status).toBe("publicado");

    // decisão superveniente "não ratificado" (revisão 2): o ledger passa a ser a verdade; o status gravado 'publicado'
    // deixa de ser sustentado (vocabulário inalterado — HD-09: aparece em ratificationBasis, não como novo status).
    await ratify(wsId, "nao_ratificado", 1);
    s = await statusOf(wsId);
    expect(s.loaded.workspace?.status).toBe("em_andamento");
    expect(s.loaded.statusBasis).toMatchObject({ ratification: "RECORDED_NOT_RATIFIED", publication: "RECORDED", unsupportedPointerClaims: ["publicado"] });

    // tenant: outro órgão não vê o processo (nem o status)
    const foreign = await statusOf(wsId, ORG_B, foreignManager);
    expect(foreign.loaded.workspace).toBeNull();
    expect(foreign.listed).toBeUndefined();
  }, 120_000);

  it("S64-3) configureFlags: evento (antes→depois, ator humano, correlationId); desligar o parecer é DECISÃO; no-op não escreve; etapa/status intactos", async () => {
    const wsId = await newWorkspace();
    await conn.execute(`UPDATE direct_procurement_workspaces SET current_stage = 'PRICE_RESEARCH', status = 'em_andamento' WHERE id = ? AND organization_id = ?`, [wsId, ORG_A]);
    const mg = await caller(manager, ORG_A, "corr-s64-3");
    const evCount = async () => Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Fluxo reconfigurado%'`, [wsId, ORG_A])).n);

    const r1 = await mg.directProcurement.configureFlags({ workspaceId: wsId, requiresLegalOpinion: false });
    expect(r1.changed).toBe(true);
    expect(r1.workspace.flags.requiresLegalOpinion).toBe(false);
    const ev = await rows(`SELECT id, actor, event_type, summary, correlation_id, ref_id FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Fluxo reconfigurado%'`, [wsId, ORG_A]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: `user:${manager}`, event_type: "decision", correlation_id: "corr-s64-3", ref_id: wsId });
    expect(String(ev[0].summary)).toContain("Exige parecer jurídico: sim → não");
    expect(String(ev[0].summary)).toContain("deixou de ser exigido");
    // só as flags mudaram: etapa/status preservados (o upsert antigo regravava o ponteiro)
    const row = await one(`SELECT current_stage, status, flags FROM direct_procurement_workspaces WHERE id = ? AND organization_id = ?`, [wsId, ORG_A]);
    expect(row).toMatchObject({ current_stage: "PRICE_RESEARCH", status: "em_andamento" });
    expect(JSON.parse(String(row.flags)).requiresLegalOpinion).toBe(false);

    // replay idêntico ⇒ no-op: nenhuma escrita, nenhum evento novo
    const before = await snapshot();
    const r2 = await mg.directProcurement.configureFlags({ workspaceId: wsId, requiresLegalOpinion: false });
    expect(r2.changed).toBe(false);
    expect(await snapshot()).toEqual(before);
    expect(await evCount()).toBe(1);

    // outra flag ⇒ outro evento (tipo "change"), 1 id novo
    const r3 = await mg.directProcurement.configureFlags({ workspaceId: wsId, requiresPriceResearch: false, requiresLegalOpinion: true });
    expect(r3.changed).toBe(true);
    expect(await evCount()).toBe(2);
    const ids = await rows(`SELECT id FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Fluxo reconfigurado%'`, [wsId, ORG_A]);
    expect(new Set(ids.map((r) => r.id)).size).toBe(2);

    // recusas sem efeito: operator (RBAC), outro órgão (NOT_FOUND neutro)
    await expectRefused("operator", async () => (await caller(operator, ORG_A)).directProcurement.configureFlags({ workspaceId: wsId, requiresLegalOpinion: false }), "FORBIDDEN", /papel mínimo 'manager'/);
    await expectRefused("foreign", async () => (await caller(foreignManager, ORG_B)).directProcurement.configureFlags({ workspaceId: wsId, requiresLegalOpinion: false }), "NOT_FOUND", /não encontrado nesta organização/);
  }, 120_000);

  const insertContract = async (org: number, directWs: string, status: string, number: string) => {
    const id = `ctw${stamp % 1e9}${++seq}`.slice(0, 20);
    await conn.execute(
      `INSERT INTO contract_workspaces (id, organization_id, origin_type, origin_process, contract_number, contractor, object, value, term, status, correlation_id)
       VALUES (?, ?, 'contratacao_direta', ?, ?, 'Contratada SEM064 Ltda', 'Notebooks', 15000, '12 meses', ?, 'sem064')`,
      [id, org, directWs, number, status]);
    return id;
  };

  it("S64-4) publish NÃO gera extrato de contrato inexistente: padrão sem extrato; opt-in sem contrato ⇒ recusa estável, ZERO escritas", async () => {
    const wsId = await newWorkspace();
    const mg = await caller(manager, ORG_A, "corr-s64-4");
    // sem ratificação ⇒ recusa existente (PR-07), sem escrita
    await expectRefused("sem ratificação", () => mg.directProcurement.publish({ workspaceId: wsId }), "PRECONDITION_FAILED", /ratificação ainda não foi registrada/);
    await ratify(wsId, "ratificado", 0);
    await validatedChecklist(wsId);

    // opt-in SEM contrato ⇒ recusa antes de qualquer escrita (publicações, documentos, evento, etapa)
    const stageBefore = await one(`SELECT current_stage, status FROM direct_procurement_workspaces WHERE id = ?`, [wsId]);
    await expectRefused("extrato sem contrato", () => mg.directProcurement.publish({ workspaceId: wsId, includeContractExtract: true }), "PRECONDITION_FAILED", /CONTRACT_EXTRACT_NO_CONTRACT/);
    expect(await one(`SELECT current_stage, status FROM direct_procurement_workspaces WHERE id = ?`, [wsId])).toEqual(stageBefore);
    // contrato em MINUTA não é contrato existente; contrato de OUTRO órgão com a mesma referência não conta
    await insertContract(ORG_A, wsId, "minuta", `MIN-${stamp}`);
    await insertContract(ORG_B, wsId, "vigente", `FOREIGN-${stamp}`);
    await expectRefused("extrato com minuta/contrato alheio", () => mg.directProcurement.publish({ workspaceId: wsId, includeContractExtract: true }), "PRECONDITION_FAILED", /CONTRACT_EXTRACT_NO_CONTRACT/);
    expect(Number((await one(`SELECT COUNT(*) n FROM generated_publications WHERE workspace_id = ?`, [wsId])).n)).toBe(0);

    // padrão: aviso + ratificação, SEM extrato; resposta diz que não foi gerado
    const out = await mg.directProcurement.publish({ workspaceId: wsId });
    expect(out.publications.map((p) => p.kind).sort()).toEqual(["aviso", "ratificacao"]);
    expect(out.contractExtract).toBe("not_requested");
    expect(Number((await one(`SELECT COUNT(*) n FROM generated_publications WHERE workspace_id = ? AND kind = 'extrato_contrato'`, [wsId])).n)).toBe(0);
    expect(Number((await one(`SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'extrato_contrato'`, [ORG_A, wsId])).n)).toBe(0);

    // evento de publicação: ator humano + correlationId; replay idêntico NÃO duplica o evento
    const pubEvents = async () => rows(`SELECT actor, correlation_id, event_type FROM process_timeline WHERE process_id = ? AND organization_id = ? AND summary LIKE 'Publicações geradas%'`, [wsId, ORG_A]);
    expect(await pubEvents()).toEqual([{ actor: `user:${manager}`, correlation_id: "corr-s64-4", event_type: "decision" }]);
    await mg.directProcurement.publish({ workspaceId: wsId });
    expect(await pubEvents()).toHaveLength(1);
    expect(Number((await one(`SELECT COUNT(*) n FROM generated_publications WHERE workspace_id = ?`, [wsId])).n)).toBe(2); // ids determinísticos: sem duplicar
  }, 120_000);

  it("S64-5) extrato SÓ de contrato REGISTRADO vinculado (dados reais do contrato); dois contratos ⇒ ambíguo; extrato legado sem contrato é marcado", async () => {
    const wsId = await newWorkspace();
    const mg = await caller(manager, ORG_A);
    await ratify(wsId, "ratificado", 0);
    await validatedChecklist(wsId);
    const cid = await insertContract(ORG_A, wsId, "vigente", `CT-${stamp}`);

    const out = await mg.directProcurement.publish({ workspaceId: wsId, includeContractExtract: true });
    expect(out.contractExtract).toBe("generated");
    expect(out.publications.map((p) => p.kind).sort()).toEqual(["aviso", "extrato_contrato", "ratificacao"]);
    const ext = await one(`SELECT content FROM generated_publications WHERE workspace_id = ? AND kind = 'extrato_contrato'`, [wsId]);
    expect(String(ext.content)).toContain(`Contrato nº CT-${stamp}`);
    expect(String(ext.content)).toContain("Contratada SEM064 Ltda");
    expect(String(ext.content)).toContain(cid);
    expect((await mg.directProcurement.loadProcess({ workspaceId: wsId })).publications.find((p) => p.kind === "extrato_contrato")?.unbacked).toBe(false);

    // segundo contrato elegível ⇒ AMBÍGUO (não escolhe um)
    await insertContract(ORG_A, wsId, "aditado", `CT2-${stamp}`);
    await expectRefused("ambíguo", () => mg.directProcurement.publish({ workspaceId: wsId, includeContractExtract: true }), "PRECONDITION_FAILED", /CONTRACT_EXTRACT_AMBIGUOUS/);

    // extrato LEGADO (gerado antes da correção, sem contrato) fica visível, marcado "sem lastro" — nunca apagado
    const w2 = await newWorkspace();
    await conn.execute(`INSERT INTO generated_publications (id, organization_id, workspace_id, kind, title, content, correlation_id) VALUES (?, ?, ?, 'extrato_contrato', 'Extrato de Contrato — legado', 'texto genérico', 'legacy')`, [`legacy${stamp % 1e9}`.slice(0, 20), ORG_A, w2]);
    const legacy = (await (await caller(manager, ORG_A)).directProcurement.loadProcess({ workspaceId: w2 })).publications;
    expect(legacy).toHaveLength(1);
    expect(legacy[0].unbacked).toBe(true);
  }, 120_000);
});
