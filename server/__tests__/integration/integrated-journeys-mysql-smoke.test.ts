/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LICIGOV-FAST — HOMOLOGAÇÃO INTEGRADA: jornadas completas (não validações fragmentadas) contra MySQL REAL, tenant SINTÉTICO.
 * Só roda com DATABASE_URL. Provider de IA = mock determinístico (nunca real). Storage S3 substituído por memória (bytes reais).
 *
 *  J1  PROCESSO NOVO — DFD → ETP → TR → Edital → exportação DOCX/PDF, pelo MESMO motor/serviços dos routers, com reuso
 *      contextual (DFD alimenta ETP; DFD+ETP alimentam TR; DFD+ETP+TR alimentam o Edital) e sem redigitação.
 *  J1-BLL A MESMA jornada com o Edital pelo MODELO INSTITUCIONAL BLL (Revisão 2 candidata, órgão sintético): o TR gerado e
 *      EMITIDO nesta jornada (pin exato) alimenta a minuta; datas de publicação diferidas ("A DEFINIR PARA PUBLICAÇÃO");
 *      DOCX/PDF; replay; tenant; nenhuma mutação no órgão de produção. (Cenários de publicação/emissão do BLL seguem nos smokes
 *      dedicados: templates-edital-deferred-publication e templates-edital-bll-e2e.)
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
import { createCanonicalManualItem, confirmCanonicalItemsFromResearch } from "../helpers/canonicalItems";
import * as mammoth from "mammoth";
import { draftContentHash } from "../../domain/generatedDocument";
import { buildDFDPrefill, computeDFDFieldStates } from "../../domain/dfdPrefill";
import { resolveProcurementContext } from "../../services/canonicalContextService";
import { saveInstitutionalIdentity } from "../../services/institutionalIdentityService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { useGlobalFixtureLock } from "../helpers/globalFixtureLock";
import { cleanupOrgs, decision, publishBllModel, setFlag, syntheticCnpj } from "../helpers/institutionalTemplatesE2eWorld";
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, type ReuseHarness } from "../helpers/contextReuseHelpers";
import { buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue, type PlannedWrite } from "../../../client/src/lib/editalPreparation";

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

// J1-BLL instala/usa o reference set GLOBAL da Lei 14.133: serializa com os demais arquivos que fazem o mesmo.
useGlobalFixtureLock("legal_reference");

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

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// J1-BLL — a MESMA jornada do J1, com o Edital pelo MODELO INSTITUCIONAL BLL (Revisão 2 candidata, datas de publicação diferidas),
// num órgão SINTÉTICO próprio. Diferente do smoke dedicado (templates-edital-deferred-publication), aqui o TR NÃO é semeado: é o TR
// gerado nesta jornada a partir do DFD/ETP, emitido pela promoção oficial real, e é esse TR (pin exato) que alimenta o Edital.
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ORG_BLL = 996403;
/** Número no formato NNNN/AAAA (usual em prefeituras): o exercício do Edital vem do próprio número, sem redigitação. */
const BLL_SEQ = String(Number.parseInt(RUN, 36) % 9000 + 1000);
const PUB_VARS = ["processo.numeroPregao", "controle.dataDivulgacaoPrevista", "processo.dataAbertura", "processo.horarioAbertura",
  "processo.dataInicioRecebimentoPropostas", "processo.dataFimRecebimentoPropostas", "processo.horarioFimRecebimentoPropostas"];
const PUBLICATION_PLACEHOLDER = "A DEFINIR PARA PUBLICAÇÃO";
const BLL_WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;
const BLL_ITEMS = [
  { description: "Papel sulfite A4 75g", unit: "resma", planned: 120, price: "25,50" },
  { description: "Caneta esferográfica azul", unit: "un", planned: 400, price: "1,75" },
];
const docxText = async (b: Buffer) => (await mammoth.extractRawText({ buffer: b })).value;
const pdfText = async (b: Buffer) => {
  const { PDFParse } = (await import("pdf-parse")) as unknown as { PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } };
  const p = new PDFParse({ data: new Uint8Array(b), verbosity: 0 });
  try { return (await p.getText()).text; } finally { await p.destroy(); }
};
/** Contagens de mutação no órgão de PRODUÇÃO (organizationId = 1): devem ser idênticas antes e depois da jornada. */
const PROD_TABLES = [
  ["institutional_template_revisions", "organization_id"], ["institutional_template_bindings", "organization_id"], ["institutional_template_identities", "organization_id"],
  ["institutional_decisions", "organization_id"], ["document_composition_manifests", "organization_id"], ["generated_documents", "organization_id"],
  ["official_documents", "tenant_id"], ["procurement_processes", "organization_id"],
] as const;
const prodSnapshot = async () => Object.fromEntries(await Promise.all(PROD_TABLES.map(async ([t, c]) => [t, await n(`SELECT COUNT(*) n FROM ${t} WHERE ${c} = 1`).catch(() => -1)] as const)));

describe.skipIf(!DB)("J1-BLL — DFD → ETP → TR (emitido) → Edital BLL Revisão 2 na MESMA jornada (MySQL real, tenant sintético)", () => {
  const UB = { owner: 0, manager: 0, operator: 0, editor: 0, ownerB: 0 };
  let k = 0;
  const key = (p: string) => `j1b-${p}-${RUN}-${++k}`;
  let prodBefore: Record<string, number>;
  let installedReferenceSet = false;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanupOrgs(conn, [ORG_BLL]);
    prodBefore = await prodSnapshot();
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await n("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "j1-bll-synthetic" });
      installedReferenceSet = true;
    }
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo, municipio, uf, esfera) VALUES (?, ?, ?, 1, 'Moreira Sales', 'PR', 'municipal') ON DUPLICATE KEY UPDATE ativo = 1, municipio = 'Moreira Sales', uf = 'PR'",
      [ORG_BLL, "Prefeitura Sintética Jornada BLL", `ij-bll-${ORG_BLL}`]);
    await saveInstitutionalIdentity(ORG_BLL, { organizationName: "Prefeitura Sintética Jornada BLL", cnpj: syntheticCnpj(ORG_BLL), address: "Rua Sintética, 100 — Centro", phone: "(44) 0000-0000", website: "https://sintetico.exemplo.gov.br" });
    await setFlag(conn, ORG_BLL, true);
    for (const k2 of Object.keys(UB) as Array<keyof typeof UB>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`ijb-${k2}-${RUN}`, `Sintético BLL ${k2}`, `ijb-${k2}-${RUN}@teste.local`]);
      UB[k2] = r.insertId;
    }
    for (const [org, u, role] of [[ORG_BLL, UB.owner, "owner"], [ORG_BLL, UB.manager, "manager"], [ORG_BLL, UB.operator, "operator"], [ORG_BLL, UB.editor, "operator"], [ORG_B, UB.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
    // Configuração institucional (UMA vez por órgão, antes de qualquer processo): modelo BLL Revisão 2 publicado e vinculado.
    await publishBllModel(ORG_BLL, 2, key);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, [ORG_BLL]).catch(() => {});
    for (const t of ["process_timeline", "operational_events", "operational_timeline", "procurement_item_events", "procurement_item_source_links", "procurement_lots", "official_document_promotions", "official_document_timeline", "generated_document_edits"]) {
      await conn.execute(`DELETE FROM ${t} WHERE ${t.startsWith("official_document_t") ? "tenant_id" : "organization_id"} = ?`, [ORG_BLL]).catch(() => {});
    }
    await conn.execute("DELETE FROM organization_members WHERE organizationId = ?", [ORG_BLL]).catch(() => {});
    await conn.query("DELETE FROM organization_members WHERE userId IN (SELECT id FROM users WHERE openId LIKE ?)", [`ijb-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`ijb-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id = ?", [ORG_BLL]).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
    // eslint-disable-next-line no-console
    console.log("[J1_BLL METRICS]", JSON.stringify(J1B_METRICS));
  }, 120_000);

  const J1B_METRICS: Record<string, unknown> = {};

  it("J1-BLL — minuta do Edital BLL Rev. 2 gerada sobre o TR emitido NESTA jornada; datas diferidas; DOCX/PDF; tenant; replay; produção intacta", async () => {
    const op = await caller(UB.operator, ORG_BLL);
    const mgr = await caller(UB.manager, ORG_BLL);
    const h: ReuseHarness = { org: ORG_BLL, proc: () => op.procurementProcess, tpl: () => mgr.institutionalTemplates, ws: BLL_WS, processId: "", key };

    // 1) PROCESSO — objeto e unidade requisitante informados UMA vez, na abertura.
    const { process } = await op.procurementProcess.createProcess({ processNumber: `${BLL_SEQ}/2026`, object: OBJ, startOption: "iniciar_pesquisa", modality: "pregao", requestingUnit: "Secretaria Municipal de Administração" });
    const pid = process.id;
    (h as { processId: string }).processId = pid;
    // Pesquisa de preços (origem dos preços) → Itens da contratação canônicos com quantidade prevista.
    await op.procurementProcess.importPriceResearch({ processId: pid, source: "colar",
      text: BLL_ITEMS.flatMap((r) => [`${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor A`, `${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor B`]).join("\n") });
    for (const it of (await op.procurementProcess.listItems({ processId: pid })).items) await op.procurementProcess.approveItem({ itemId: it.id });
    await confirmCanonicalItemsFromResearch({ organizationId: ORG_BLL, processId: pid, actorUserId: UB.operator, idempotencyKey: key("items"), planned: Object.fromEntries(BLL_ITEMS.map((r) => [r.description, r.planned])) });

    // 2) DFD — sem IA, do contexto canônico (objeto, unidade, itens).
    const { document: dfd } = await op.procurementProcess.generateDFD({ processId: pid, idempotencyKey: key("dfd") });
    expect(dfd.content).toContain(OBJ);
    expect(dfd.content).toContain("Secretaria Municipal de Administração");
    for (const it of BLL_ITEMS) expect(dfd.content).toContain(it.description);
    const dfdStates = computeDFDFieldStates(dfd.content, dfd.sources ?? [], buildDFDPrefill(await resolveProcurementContext({ organizationId: ORG_BLL, processId: pid })));
    const tally = (xs: readonly string[]) => xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
    J1B_METRICS.DFD = { total: dfdStates.length, byState: tally(dfdStates.map((s) => s.state)), pendingHuman: dfdStates.filter((s) => s.state === "unknown").map((s) => s.key) };

    // 3) ETP — reutiliza o DFD (rotas reais; provider de IA = mock da suíte).
    const etpCtx = await resolveDocumentAuthoringContext({ organizationId: ORG_BLL, processId: pid, kind: "etp", object: OBJ });
    expect(etpCtx.sourceVersions.dfd.present).toBe(true);
    const { document: etp } = await op.procurementProcess.generateETP({ processId: pid, object: OBJ, idempotencyKey: key("etp") });
    expect(etp.content.length).toBeGreaterThan(100);
    J1B_METRICS.ETP = { usedSources: etpCtx.usedSources, missing: etpCtx.missing, itemsReused: etpCtx.estimate.itemCount, pricedItems: etpCtx.estimate.pricedItemCount };

    // 4) TR — parâmetros estruturados confirmados no TR (mesmos dados que o Edital consumirá) → TR gerado com DFD+ETP+itens.
    const trParamsBefore = await op.procurementProcess.trStructuredParams({ processId: pid, ...BLL_WS });
    const trTyped = (await fillTrParams(h, {}, ["processo.objetoCompleto"])).typed;
    const trCtx = await resolveDocumentAuthoringContext({ organizationId: ORG_BLL, processId: pid, kind: "tr", object: OBJ });
    expect(trCtx.sourceVersions.dfd.present && trCtx.sourceVersions.etp.present).toBe(true);
    const { document: trDraft } = await op.procurementProcess.generateTR({ processId: pid, object: OBJ, idempotencyKey: key("tr") });
    for (const it of BLL_ITEMS) expect(trDraft.content).toContain(it.description);
    expect((trDraft.sources ?? []).some((s: string) => /^trparams:[a-f0-9]{64}$/.test(s)), "TR carrega o snapshot dos parâmetros estruturados").toBe(true);
    J1B_METRICS.TR = {
      structuredTotal: (trParamsBefore.fields as any[]).filter((f) => f.active).length,
      structuredPrefilled: (trParamsBefore.fields as any[]).filter((f) => f.active && f.status === "SET").length,
      structuredConfirmedByHuman: trTyped.length, structuredConfirmedNames: trTyped, usedSources: trCtx.usedSources, missing: trCtx.missing,
    };
    // Revisão humana do TR (marcadores [REVISAR] resolvidos por um editor) → emissão oficial por terceiro (SoD).
    const human = trDraft.content.replace(/\[REVISAR[^\]]*\]/g, "Texto conferido pela equipe.");
    if (human !== trDraft.content) {
      await (await caller(UB.editor, ORG_BLL)).procurementProcess.saveReviewableDraft({ processId: pid, kind: "tr", content: human, expectedContentHash: draftContentHash(trDraft.content), idempotencyKey: key("tr-edit") });
    }
    const promoInput = { processId: pid, kind: "tr" as const, idempotencyKey: key("tr-promo"), expectedContentHash: draftContentHash(human), reason: "TR revisado e conferido." };
    const promoted = await mgr.procurementProcess.promoteOfficial(promoInput);
    expect(promoted.promoted).toBe(true);
    // Replay da emissão: mesma chave ⇒ mesma versão, nenhuma segunda linha.
    expect((await mgr.procurementProcess.promoteOfficial(promoInput)).replayed).toBe(true);
    const trRows = await rows<{ id: string; version: number; metadata: any }>("SELECT id, version, metadata FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'tr' AND status = 'emitido'", [ORG_BLL, pid]);
    expect(trRows).toHaveLength(1);
    const trMeta = typeof trRows[0].metadata === "string" ? JSON.parse(trRows[0].metadata) : trRows[0].metadata;
    // A PROMOÇÃO REAL grava o objeto e o digest dos parâmetros do TR (nada carimbado pelo teste).
    expect(trMeta.object).toBe(OBJ);
    expect(trMeta.structuredParamsDigest).toMatch(/^[a-f0-9]{64}$/);
    const trPin = { documentId: promoted.officialDocument.id, version: promoted.officialDocument.version, contentHash: promoted.officialDocument.contentHash };

    // 5) EDITAL BLL — só o que é genuinamente do certame/órgão; datas de publicação NÃO são pedidas.
    await completeProfile(h);
    await setBudgetDisclosure(h);
    await setItemsParticipation(h);
    const prep = (await op.procurementProcess.editalTemplatePreparation({ processId: pid, ...BLL_WS, officialPins: { TR: trPin } })) as any;
    expect(prep.status).toBe("READY_FOR_PREPARATION");
    expect(prep.trPin.state).not.toBe("NOT_SELECTED");
    const typedDecisions: string[] = [];
    for (let round = 1; round <= 8; round++) {
      const st = (await op.procurementProcess.editalTemplatePreparation({ processId: pid, ...BLL_WS, officialPins: { TR: trPin } })) as any;
      const pend = livePendingItems(st, {});
      if (pend.length === 0) break;
      const edits: Record<string, Record<string, any>> = {};
      for (const { section, field } of pend) { (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValueByName(field.name)); typedDecisions.push(field.name); }
      const plan = buildSavePlan(st, { edits: edits as any });
      expect(plan.errors).toEqual({});
      const out = await executeSavePlan(plan.writes, st.revisions, {
        async write(w: PlannedWrite, expectedRevision: number) {
          const base = { confirm: true as const, idempotencyKey: key(w.id), decision: decision(), expectedRevision, catalogVersion: st.catalogVersion, fields: w.fields ?? {} };
          const r: any = w.kind === "ORG"
            ? await mgr.institutionalTemplates.governed.recordOrganizationFields({ ...base, source: w.source as any })
            : await mgr.institutionalTemplates.governed.recordCertameConfig({ ...base, processId: pid, source: w.source as any });
          return { revision: r.decision.revision as number };
        },
      }, (e) => isStaleSave((e as any)?.data?.code, e instanceof Error ? e.message : String(e)));
      expect(out.failed, JSON.stringify(out.failed)).toBeNull();
    }
    for (const v of PUB_VARS) expect(typedDecisions, `data/hora de publicação não pode ser exigida na minuta: ${v}`).not.toContain(v);
    const st = (await op.procurementProcess.editalTemplatePreparation({ processId: pid, ...BLL_WS, officialPins: { TR: trPin } })) as any;
    expect(livePendingItems(st, {})).toEqual([]);
    expect(st.metrics.DEFERRED_PUBLICATION).toBe(PUB_VARS.length);
    expect(st.publication.readiness).toMatchObject({ complete: false, total: PUB_VARS.length });
    const pre = (await op.procurementProcess.editalTemplatePreflight({ processId: pid, ...BLL_WS, officialPins: { TR: trPin } })) as any;
    expect(pre.status, JSON.stringify(pre.issues ?? [])).toBe("READY_FOR_COMPOSITION");

    const genInput = { processId: pid, object: OBJ, ...BLL_WS, officialPins: { TR: trPin }, idempotencyKey: key("edital") };
    const ed = (await op.procurementProcess.generateNotice(genInput as any)) as any;
    expect(ed.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const text = (await rows<{ content: string }>("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [ORG_BLL, pid]))[0].content;
    // Reuso: objeto, itens (do TR/Itens), órgão e plataforma; publicação diferida com placeholder; nenhuma data inventada.
    expect(text).toContain(OBJ);
    for (const it of BLL_ITEMS) expect(text).toContain(it.description);
    // Numeração: "Nº {sequência}/{exercício}" — exercício lido do número NNNN/AAAA, sem separador de milhar e sem duplicar o ano.
    expect(text).toContain(`PROCESSO ADMINISTRATIVO Nº ${BLL_SEQ}/2026`);
    expect(text).not.toMatch(/2\.026/);
    expect(text).toContain(`Nº ${PUBLICATION_PLACEHOLDER}/2026`);
    expect(text).toContain(PUBLICATION_PLACEHOLDER);
    for (const v of PUB_VARS) expect(text, v).not.toContain(String(scenarioValueByName(v)));
    expect(text).not.toMatch(/\[REVISAR[^\]]*(numeroPregao|dataAbertura|horarioAbertura|RecebimentoPropostas|dataDivulgacao)/);
    const manifest = (await rows<{ b: any }>("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [ORG_BLL, ed.generationManifestId]))[0];
    const body = typeof manifest.b === "string" ? JSON.parse(manifest.b) : manifest.b;
    expect(body.deferredPublication.map((x: any) => x.variable)).toEqual([...PUB_VARS].sort());
    // Proveniência: o pin exato do TR emitido NESTA jornada.
    const refs = await rows<{ document_id: string; version: number; content_hash: string }>("SELECT document_id, version, content_hash FROM document_composition_references WHERE organization_id = ? AND manifest_id = ?", [ORG_BLL, ed.generationManifestId]);
    expect(refs).toEqual(expect.arrayContaining([expect.objectContaining({ document_id: trPin.documentId, version: trPin.version, content_hash: trPin.contentHash })]));
    // Replay da geração: mesma chave ⇒ mesmo rascunho, sem novo manifesto.
    const manifestsBefore = await n("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [ORG_BLL]);
    const again = (await op.procurementProcess.generateNotice(genInput as any)) as any;
    expect(again.generationManifestId ?? ed.generationManifestId).toBe(ed.generationManifestId);
    expect(await n("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [ORG_BLL])).toBe(manifestsBefore);
    // Prontidão para FINALIZAÇÃO preservada: a minuta não é emissível como oficial enquanto faltarem os dados de publicação.
    J1B_METRICS.EDITAL = {
      TOTAL_TEMPLATE_FIELDS: st.metrics.TOTAL_TEMPLATE_FIELDS, BY_CLASS: st.metrics.BY_CLASS, UPSTREAM_TR_REUSED: st.metrics.UPSTREAM_TR_REUSED,
      AUTO_RESOLVED: st.metrics.AUTO_RESOLVED, ORG_REUSED: st.metrics.ORG_REUSED, TR_PROJECTED: st.metrics.TR_PROJECTED,
      CONDITIONAL_HIDDEN: st.metrics.CONDITIONAL_HIDDEN, POST_AWARD_HIDDEN: st.metrics.POST_AWARD_HIDDEN, OPTIONAL_HIDDEN: st.metrics.OPTIONAL_HIDDEN,
      DEFERRED_PUBLICATION: st.metrics.DEFERRED_PUBLICATION, DECISIONS_TYPED_IN_EDITAL: typedDecisions.length, DECISIONS_TYPED_NAMES: typedDecisions,
    };

    // 6) EXPORTAÇÃO — DOCX/PDF dos QUATRO documentos (rascunhos, marcados como tal); a minuta exibe o placeholder e nunca marcador interno.
    for (const kind of ["dfd", "etp", "tr", "edital"] as const) {
      for (const format of ["docx", "pdf"] as const) {
        const out = await op.procurementProcess.exportDocument({ processId: pid, kind, format });
        const key2 = [...STORED.keys()].filter((x) => x.endsWith(`.${format}`) && x.includes(`/${ORG_BLL}/`)).pop()!;
        const buf = STORED.get(key2)!;
        expect(format === "docx" ? isDocx(buf) : isPdf(buf), `${kind}.${format}`).toBe(true);
        expect(out.fileName).toMatch(new RegExp(`^${kind.toUpperCase()}_${BLL_SEQ}-2026_`));
        if (kind === "edital") {
          const t = format === "docx" ? await docxText(buf) : await pdfText(buf);
          expect(t, `edital.${format}`).toContain(PUBLICATION_PLACEHOLDER);
          expect(t, `edital.${format}`).not.toContain("SYSTEM_LATE_BOUND");
          // Estrutura do modelo preservada (cláusulas-chave do BLL presentes na exportação).
          expect(t).toMatch(/HABILITA[ÇC][AÃ]O/i);
          expect(t).toMatch(/PROPOSTA/i);
        }
      }
    }

    // 7) TENANT — outro órgão não lê, não prepara, não gera nem exporta.
    const b = (await caller(UB.ownerB, ORG_B)).procurementProcess;
    for (const call of [
      () => b.editalTemplatePreflight({ processId: pid, ...BLL_WS, officialPins: { TR: trPin } }),
      () => b.exportDocument({ processId: pid, kind: "edital", format: "docx" }),
      () => b.generateNotice({ ...genInput, idempotencyKey: key("x") } as any),
    ]) expect((await err(call()))?.code).toBe("NOT_FOUND");
    // 8) PRODUÇÃO — nenhuma linha do órgão 1 criada/alterada por esta jornada.
    expect(await prodSnapshot()).toEqual(prodBefore);
  }, 600_000);
});
