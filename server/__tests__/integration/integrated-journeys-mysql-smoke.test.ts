/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LICIGOV-FAST — HOMOLOGAÇÃO INTEGRADA: jornadas completas (não validações fragmentadas) contra MySQL REAL, tenant SINTÉTICO.
 * Só roda com DATABASE_URL. Provider de IA = mock determinístico (nunca real). Storage S3 substituído por memória (bytes reais).
 *
 *  J1  PROCESSO NOVO — DFD → ETP → TR → Edital → exportação DOCX/PDF, pelo MESMO motor/serviços dos routers, com reuso
 *      contextual (DFD alimenta ETP; DFD+ETP alimentam TR; DFD+ETP+TR alimentam o Edital) e sem redigitação.
 *      (O Edital por modelo institucional BLL/Revisão 2 — datas diferidas, placeholders — tem smoke próprio:
 *      templates-edital-deferred-publication e templates-edital-bll-e2e.)
 *  J2  PROCESSO LEGADO — contrato VIGENTE de processo anterior registrado por declaração (sem DFD/ETP/TR/Edital) →
 *      aditivo de prazo → termo gerado e exportado; vencimento + alertas no Centro de Operações; RBAC, replay e tenant.
 *  J3  MONITORAMENTO — contrato externo registrado só para acompanhamento com término da vigência ⇒ vencimento e alertas no
 *      calendário; indicador conta CONTRATOS (não alertas); tipos sem vigência recusam o término; legado importado no painel.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const STORED = new Map<string, Buffer>();
vi.mock("../../storage", async (orig) => ({
  ...(await orig<typeof import("../../storage")>()),
  assertStorageUsable: () => undefined,
  storagePut: async (key: string, data: Buffer | Uint8Array | string) => { STORED.set(key, Buffer.from(data as any)); return { key, url: `memory://${key}` }; },
  storageSignedUrl: async (key: string) => ({ key, url: `memory://${key}` }),
}));

import { runMigrations } from "../../bootstrap";
import { generateDocument, generateNotice } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";
import { createCanonicalManualItem } from "../helpers/canonicalItems";

const DB = process.env.DATABASE_URL;
const ORG = 996401;
const ORG_B = 996402;
const RUN = Date.now().toString(36);
const OBJ = "Aquisição de material de expediente (sintético)";
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

let conn: mysql.Connection;
const U = { owner: 0, manager: 0, operator: 0, ownerB: 0 };
let seq = 0;

async function caller(userId: number, org = ORG) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ij-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
    correlationId: `corr-ij-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}
const isDocx = (b: Buffer) => b.subarray(0, 2).toString() === "PK";
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["official_document_artifacts", "tenant_id"], ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"],
      ["official_documents", "tenant_id"], ["contract_addenda", "organization_id"], ["contract_ws_apostilles", "organization_id"],
      ["contract_ws_documents", "organization_id"], ["contract_workspaces", "organization_id"],
      ["operational_events", "organization_id"], ["operational_timeline", "organization_id"], ["operation_records", "organization_id"],
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"],
      ["generated_documents", "organization_id"], ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"],
      ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("LICIGOV-FAST — jornadas integradas (MySQL real, tenant sintético)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const org of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1",
        [org, `Prefeitura Sintética Jornadas ${org}`, `ij-sintetica-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`ij-${k}-${RUN}`, `Sintético ${k}`, `ij-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG, U.owner, "owner"], [ORG, U.manager, "manager"], [ORG, U.operator, "operator"], [ORG_B, U.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`ij-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("J1 — processo novo: DFD → ETP → TR → Edital com reuso contextual e exportação DOCX/PDF dos quatro documentos", async () => {
    const api = await caller(U.owner);
    const { process } = await api.procurementProcess.createProcess({ processNumber: `IJ-${RUN}`, object: OBJ, startOption: "iniciar_pesquisa" });
    const pid = process.id;
    await createCanonicalManualItem({ organizationId: ORG, processId: pid, actorUserId: U.owner, description: "Papel A4 75g", unit: "resma", plannedQuantity: "120" });

    // DFD: sem IA, preenchido a partir do contexto canônico (objeto + itens) — nada redigitado.
    const { document: dfd } = await api.procurementProcess.generateDFD({ processId: pid, idempotencyKey: `ij-dfd-${RUN}` });
    expect(dfd.content).toContain(OBJ);
    expect(dfd.content).toMatch(/Papel A4 75g/);

    // ETP reutiliza o DFD; TR reutiliza DFD + ETP (mesmos resolvedores do router).
    const etpCtx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: pid, kind: "etp", object: OBJ });
    expect(JSON.stringify(etpCtx)).toMatch(/dfd/i);
    const gen = (kind: "etp" | "tr") => generateDocument({
      organizationId: ORG, processId: pid, kind, object: OBJ, correlationId: `ij-${kind}`, idempotencyKey: `ij-${kind}-${RUN}`, actorUserId: U.owner,
      invoke: async () => buildMockProviderAuthoring(kind),
    });
    const etp = await gen("etp");
    expect(etp.document.content.length).toBeGreaterThan(100);
    const trCtx = await resolveDocumentAuthoringContext({ organizationId: ORG, processId: pid, kind: "tr", object: OBJ });
    expect(JSON.stringify(trCtx)).toMatch(/etp/i);
    const tr = await gen("tr");
    expect(tr.document.content).toMatch(/Papel A4 75g/);

    // Edital (motor padrão do órgão sem modelo vinculado): reutiliza DFD/ETP/TR e os itens; nenhuma etapa anterior é recriada.
    const ed = await generateNotice({
      organizationId: ORG, processId: pid, object: OBJ, modality: "pregao", form: "eletronico", platform: "compras_gov",
      correlationId: "ij-edital", idempotencyKey: `ij-ed-${RUN}`, actorUserId: U.owner, invoke: async () => buildMockProviderAuthoring("edital"),
    });
    expect(ed.validation.valid).toBe(true);
    expect(ed.document.content).toMatch(/Papel A4 75g/);
    const kinds = (await rows<{ kind: string }>("SELECT kind FROM generated_documents WHERE organization_id = ? AND process_id = ? ORDER BY kind", [ORG, pid])).map((r) => r.kind);
    expect(kinds).toEqual(["dfd", "edital", "etp", "tr"]);

    // Exportação pelo router real (rascunho exporta, marcado como rascunho): bytes reais DOCX e PDF.
    for (const kind of ["dfd", "etp", "tr", "edital"] as const) {
      for (const format of ["docx", "pdf"] as const) {
        const out = await api.procurementProcess.exportDocument({ processId: pid, kind, format });
        expect(out.fileName).toMatch(new RegExp(`^${kind.toUpperCase()}_IJ-${RUN}_rascunho_v1\\.${format}$`));
        const key = [...STORED.keys()].filter((k) => k.endsWith(`.${format}`) && k.includes(`/${ORG}/`)).pop()!;
        const buf = STORED.get(key)!;
        expect(format === "docx" ? isDocx(buf) : isPdf(buf), `${kind}.${format}`).toBe(true);
      }
    }
    // Tenant: outro órgão não exporta nem lê o processo.
    expect((await err((await caller(U.ownerB, ORG_B)).procurementProcess.exportDocument({ processId: pid, kind: "dfd", format: "docx" })))?.code).toBe("NOT_FOUND");
  }, 300_000);

  it("J2 — legado: contrato vigente registrado por declaração → aditivo de prazo → termo exportado; vencimento no Centro de Operações", async () => {
    const input = {
      idempotencyKey: `ij-legacy-${RUN}`, contractNumber: `CT-LEG-${RUN}`, contractor: "Fornecedor Sintético Ltda", object: "Manutenção predial (sintético)",
      term: "12 meses", value: 48000, endDate: plusDays(45), sourceReference: "Pregão 12/2023 (sintético)",
    };
    // RBAC: operador não registra contrato vigente (nasce vigente ⇒ piso manager); nada é gravado.
    expect((await err((await caller(U.operator)).contractWorkspace.registerInForceContract(input)))?.code).toBe("FORBIDDEN");
    expect(await n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ?", [ORG])).toBe(0);

    const mgr = await caller(U.manager);
    const r = await mgr.contractWorkspace.registerInForceContract(input);
    expect(r.workspace).toMatchObject({ status: "vigente", originType: "legado", contractNumber: input.contractNumber });
    expect(r.provenance).toBe("DECLARADO");
    // Replay: mesma chave ⇒ mesmo resultado, sem segunda linha nem segundo evento.
    const again = await mgr.contractWorkspace.registerInForceContract(input);
    expect(again.workspace.id).toBe(r.workspace.id);
    expect(await n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ?", [ORG])).toBe(1);
    const tl = await rows<{ summary: string; actor: string }>("SELECT summary, actor FROM process_timeline WHERE organization_id = ? AND process_id = ?", [ORG, r.workspace.id]);
    expect(tl).toHaveLength(1);
    expect(tl[0].actor).toBe(`user:${U.manager}`);
    expect(tl[0].summary).toMatch(/DECLARADO pelo usuário, não verificada/);
    // Mesma chave com dados diferentes ⇒ CONFLICT.
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, value: 1 })))?.code).toBe("CONFLICT");

    // Aditivo de prazo direto sobre o contrato legado — nenhum DFD/ETP/TR/Edital exigido.
    const ad = await mgr.contractWorkspace.createAddendum({ idempotencyKey: `ij-ad-${RUN}`, contractId: r.workspace.id, addendumType: "prazo", justification: "Prorrogação por mais 12 meses (sintético).", newTerm: "24 meses" });
    expect(ad.addendum).toBeTruthy();
    const docs = await rows<{ id: string; document_type: string }>("SELECT id, document_type FROM official_documents WHERE origin = ? AND tenant_id = ?", [r.workspace.id, ORG]);
    const termo = docs.find((d) => d.document_type === "aditivo");
    expect(termo, "termo aditivo gerado").toBeTruthy();
    for (const format of ["docx", "pdf"] as const) {
      const out = await mgr.documentEngine.exportInstitutional({ documentId: termo!.id, format });
      expect(out.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    }

    // Vencimento + alertas no Centro de Operações (regra existente registerExpiration), contado UMA vez.
    const cal = await mgr.departmentOperation.calendar({ from: TODAY, to: plusDays(60) });
    const venc = cal.events.filter((e: any) => e.referenceId === r.workspace.id);
    expect(venc.some((e: any) => e.eventType === "vencimento_contrato" && e.eventDate === input.endDate)).toBe(true);
    const dash = await mgr.departmentOperation.dashboard({ today: TODAY });
    expect((dash as any).indicators.contractsExpiring).toBe(1);

    // Tenant: outro órgão não vê nem adita o contrato.
    expect((await err((await caller(U.ownerB, ORG_B)).contractWorkspace.createAddendum({ idempotencyKey: `ij-adb-${RUN}`, contractId: r.workspace.id, addendumType: "prazo", justification: "x", newTerm: "1 mês" })))?.code).toBe("NOT_FOUND");
    // Ativação de minuta continua bloqueada (pendente de definição jurídica): nada mudou nesse caminho.
    const minuta = await mgr.contractWorkspace.createManual({ idempotencyKey: `ij-min-${RUN}`, contractNumber: `CT-MIN-${RUN}` });
    expect(minuta.workspace.status).toBe("minuta");
    expect((await err(mgr.contractWorkspace.createAddendum({ idempotencyKey: `ij-admin-${RUN}`, contractId: minuta.workspace.id, addendumType: "prazo", justification: "x", newTerm: "1 mês" })))?.code).toBe("BAD_REQUEST");
  }, 300_000);

  it("J3 — monitoramento: contrato externo com término ⇒ vencimento e alertas no calendário; indicador por contrato; sem vigência ⇒ recusa", async () => {
    const api = await caller(U.operator);
    const end = plusDays(20);
    const { record } = await api.operationRecord.createRecord({
      recordType: "contrato_externo", origin: "externa", number: `CE-${RUN}`, object: "Locação de veículos (sintético)", expirationDate: end,
    });
    const cal = await api.departmentOperation.calendar({ from: TODAY, to: plusDays(30) });
    const mine = cal.events.filter((e: any) => e.referenceId === record.id);
    expect(mine.find((e: any) => e.eventDate === end)?.eventType).toBe("vencimento_contrato");
    expect(mine.some((e: any) => e.eventDate === plusDays(20 - 15))).toBe(true); // alerta de 15 dias
    expect(mine.some((e: any) => e.eventDate === plusDays(20 - 7))).toBe(true); // alerta de 7 dias
    // Indicador: J2 (1 contrato) + este (1 contrato) = 2, mesmo com 5 alertas cada.
    expect(((await api.departmentOperation.dashboard({ today: TODAY })) as any).indicators.contractsExpiring).toBe(2);

    // Tipo sem vigência não transforma data em alerta.
    expect((await err(api.operationRecord.createRecord({ recordType: "reuniao", expirationDate: end })))?.code).toBe("BAD_REQUEST");
    // Legado só para acompanhamento (sem documento algum) aparece no painel de acompanhamento.
    const imp = await api.operationRecord.importLegacy({ recordType: "processo_licitatorio_legado", rawText: "Processo nº 45/2022 — Pregão Eletrônico — Objeto: aquisição de mobiliário escolar." });
    const panel = await api.departmentOperation.monitoringPanel({ today: TODAY });
    expect((panel as any).rows ?? panel).toEqual(expect.arrayContaining([expect.objectContaining({ processId: imp.record.id, origin: "processo_licitatorio_legado" })]));
    // Tenant: outro órgão não enxerga os eventos.
    const calB = await (await caller(U.ownerB, ORG_B)).departmentOperation.calendar({ from: TODAY, to: plusDays(60) });
    expect(calB.events.filter((e: any) => e.referenceId === record.id)).toEqual([]);
  }, 120_000);
});
