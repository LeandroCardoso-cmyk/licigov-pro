/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * JORNADA INTEGRADA — processos legados + contratos + aditivos + monitoramento (MySQL REAL, tenant SINTÉTICO, router real).
 * Só roda com DATABASE_URL. Estende (não repete) J2/J3 de `integrated-journeys-mysql-smoke`: aqui só entram os comportamentos NOVOS
 * e as lacunas corrigidas, mais a validação de ponta a ponta da contratação direta e do pedido de parecer.
 *
 *  J5  REGISTRO LEGADO → CONTRATO VIGENTE (reaproveitando o registro) → ADITIVOS ANTERIORES (histórico DECLARADO) → ADITIVO DE PRAZO
 *      com novo término → TERMO exportado (DOCX/PDF) com histórico → VIGÊNCIA reagendada (calendário/KPI sem duplicar)
 *  J6  CONTRATO EXTERNO JÁ MONITORADO → contrato completo SEM alertas duplicados e SEM contar duas vezes no indicador
 *  J7  PARECER: pedido pelo contrato vira solicitação institucional; nenhum parecer/decisão é produzido pelo sistema
 *  J4  CONTRATAÇÃO DIRETA (módulo existente): entrada sem DFD → justificativas → ratificação → contrato por herança confirmada → exportação
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import * as mammoth from "mammoth";

const STORED = new Map<string, Buffer>();
vi.mock("../../storage", async (orig) => ({
  ...(await orig<typeof import("../../storage")>()),
  assertStorageUsable: () => undefined,
  storagePut: async (key: string, data: Buffer | Uint8Array | string) => { STORED.set(key, Buffer.from(data as any)); return { key, url: `memory://${key}` }; },
  storageSignedUrl: async (key: string) => ({ key, url: `memory://${key}` }),
}));

import { runMigrations } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const ORG = 996701;
const ORG_B = 996702;
const RUN = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

let conn: mysql.Connection;
const U = { manager: 0, operator: 0, viewer: 0, managerB: 0 };
let seq = 0;

async function caller(userId: number, org = ORG) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `lc-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `corr-lc-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}
const isDocx = (b: Buffer) => b.subarray(0, 2).toString() === "PK";
const isPdf = (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-";
const lastStored = (ext: string, org = ORG) => STORED.get([...STORED.keys()].filter((k) => k.endsWith(`.${ext}`) && k.includes(`/${org}/`)).pop()!)!;

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["official_document_artifacts", "tenant_id"], ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"],
      ["official_documents", "tenant_id"], ["contract_addenda", "organization_id"], ["contract_ws_apostilles", "organization_id"],
      ["contract_ws_documents", "organization_id"], ["contract_workspaces", "organization_id"],
      ["operational_events", "organization_id"], ["operational_timeline", "organization_id"], ["operation_records", "organization_id"],
      ["direct_procurement_workspaces", "organization_id"], ["direct_procurement_procedures", "organization_id"], ["proposal_collections", "organization_id"],
      ["proposal_documents", "organization_id"], ["contract_justifications", "organization_id"], ["price_justifications", "organization_id"],
      ["required_documents", "organization_id"], ["ratifications", "organization_id"], ["generated_publications", "organization_id"],
      ["institutional_decisions", "organization_id"], ["institutional_requests", "organization_id"], ["request_assignments", "organization_id"],
      ["request_timelines", "organization_id"], ["request_notifications", "organization_id"], ["ai_execution_audits", "organization_id"],
      ["process_timeline", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("Jornada integrada — legado, contratos, aditivos, monitoramento, parecer e contratação direta (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const org of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Prefeitura Sintética LC ${org}`, `lc-sintetica-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`lc-${k}-${RUN}`, `Sintético ${k}`, `lc-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG, U.manager, "manager"], [ORG, U.operator, "operator"], [ORG, U.viewer, "viewer"], [ORG_B, U.managerB, "manager"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`lc-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  const expiryEvents = async (ref: string) => rows<{ event_date: string; alert_offset_days: number }>(
    "SELECT event_date, alert_offset_days FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'vencimento_contrato' ORDER BY alert_offset_days, event_date", [ORG, ref]);

  it("J5 — registro legado → contrato vigente (dados reaproveitados) → aditivos anteriores declarados → aditivo de prazo reagenda a vigência → termo exportado com histórico", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    // 1) Registro do processo anterior (entrada independente — nenhum DFD/ETP/TR/Edital).
    const imp = await op.operationRecord.importLegacy({ recordType: "processo_licitatorio_legado", rawText: "Processo nº 45/2022\nModalidade: Pregão Eletrônico\nObjeto: Manutenção predial dos prédios municipais (sintético)." });
    const legacyId = imp.record.id;
    expect(imp.record.object).toMatch(/Manutenção predial/);

    const input = {
      idempotencyKey: `lc-j5-${RUN}`, contractNumber: `CT-J5-${RUN}`, contractor: "Fornecedor Sintético J5 Ltda", term: "12 meses", value: 48000,
      endDate: plusDays(45), legacyRecordId: legacyId,
      priorAmendments: [
        { type: "prazo" as const, newTerm: "12 meses", reference: "1º Termo Aditivo (sintético)", signedOn: "2025-03-12" },
        { type: "valor" as const, reference: "2º Termo Aditivo (sintético)" },
      ],
    };
    // RBAC + recusas ANTES de qualquer escrita.
    expect((await err(op.contractWorkspace.registerInForceContract(input)))?.code).toBe("FORBIDDEN");
    expect((await err((await caller(U.managerB, ORG_B)).contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `lc-j5b-${RUN}` })))?.code).toBe("NOT_FOUND"); // registro de outro órgão
    const reuniao = await op.operationRecord.createRecord({ recordType: "reuniao", eventDate: plusDays(3) });
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `lc-j5c-${RUN}`, legacyRecordId: reuniao.record.id })))?.code).toBe("BAD_REQUEST");
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `lc-j5d-${RUN}`, contractNumber: `CT-J5X-${RUN}`, legacyRecordId: undefined, object: undefined })))?.code).toBe("BAD_REQUEST"); // sem objeto e sem registro
    expect(await n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ?", [ORG])).toBe(0);

    // 2) Contrato vigente SEM digitar o objeto: vem do registro; vínculo; histórico declarado; vigência agendada.
    const r = await mgr.contractWorkspace.registerInForceContract(input);
    const cid = r.workspace.id;
    expect(r.workspace).toMatchObject({ status: "vigente", originType: "legado" });
    expect(r.workspace.object).toMatch(/Manutenção predial/);
    expect(r.provenance).toBe("DECLARADO");
    expect(r.legacyRecord).toMatchObject({ id: legacyId, reusedFields: expect.arrayContaining(["object", "sourceReference"]) });
    expect(r.priorAmendmentsRecorded).toBe(2);
    const rec = (await rows("SELECT reference_type, reference_id FROM operation_records WHERE id = ?", [legacyId]))[0];
    expect(rec).toEqual({ reference_type: "contract_workspace", reference_id: cid });
    const tl = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE organization_id = ? AND process_id = ? ORDER BY id", [ORG, cid]);
    expect(tl.map((t) => t.summary).join(" | ")).toMatch(/Origem declarada: Processo licitatório legado nº 45\/2022/);
    expect(tl.map((t) => t.summary).join(" | ")).toMatch(/2 aditivo\(s\) anterior\(es\).*DECLARADO.*nº 3/);
    // Replay (mesma chave): converge; nenhum registro novo. Mesmo registro para OUTRO contrato ⇒ CONFLICT; chave igual com dados diferentes ⇒ CONFLICT.
    expect((await mgr.contractWorkspace.registerInForceContract(input)).workspace.id).toBe(cid);
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE organization_id = ? AND contract_id = ?", [ORG, cid])).toBe(2);
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `lc-j5e-${RUN}`, contractNumber: `CT-J5Y-${RUN}` })))?.code).toBe("CONFLICT");
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, value: 1 })))?.code).toBe("CONFLICT");
    // Histórico DECLARADO: finalizados, origem documento externo, sem termo gerado, contrato segue vigente.
    const prior = await rows("SELECT sequence, addendum_type, status, request_origin, justification FROM contract_addenda WHERE organization_id = ? AND contract_id = ? ORDER BY sequence", [ORG, cid]);
    expect(prior).toHaveLength(2);
    expect(prior.every((p: any) => p.status === "finalizado" && p.request_origin === "documento_externo" && /DECLARADO/.test(p.justification))).toBe(true);
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [ORG, cid])).toBe(0);
    expect((await rows("SELECT status FROM contract_workspaces WHERE id = ?", [cid]))[0].status).toBe("vigente");
    // Vigência acompanhada: vencimento + 5 alertas, UMA vez.
    expect((await expiryEvents(cid)).map((e) => e.event_date)).toContain(plusDays(45));
    expect(await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, cid])).toBe(6);
    expect((await mgr.contractWorkspace.loadContract({ contractId: cid })).expiration).toEqual({ endDate: plusDays(45), source: "centro_operacoes" });

    // 3) Aditivo de PRAZO com novo término: o termo continua a numeração (nº 3) e a vigência é REAGENDADA.
    const newEnd = plusDays(80);
    const adInput = { idempotencyKey: `lc-j5-ad-${RUN}`, contractId: cid, addendumType: "prazo" as const, justification: "Prorrogação por mais 12 meses (sintético).", newTerm: "24 meses", newEndDate: newEnd };
    expect((await err(op.contractWorkspace.createAddendum(adInput)))?.code).toBe("FORBIDDEN");
    expect((await err(mgr.contractWorkspace.createAddendum({ ...adInput, idempotencyKey: `lc-j5-adv-${RUN}`, addendumType: "valor" })))?.code).toBe("BAD_REQUEST"); // data só em aditivo de prazo
    expect((await err(mgr.contractWorkspace.createAddendum({ ...adInput, idempotencyKey: `lc-j5-adi-${RUN}`, newEndDate: "2026-02-30" })))?.code).toBe("BAD_REQUEST");
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE organization_id = ? AND contract_id = ?", [ORG, cid])).toBe(2);
    expect((await expiryEvents(cid)).map((e) => e.event_date)).toContain(plusDays(45)); // recusas não mexeram na vigência

    const ad = await mgr.contractWorkspace.createAddendum(adInput);
    expect(ad.addendum).toMatchObject({ sequence: 3, addendumType: "prazo", status: "finalizado" });
    expect(ad.addendum.newTerm).toMatch(/^24 meses — término da vigência em \d{2}\/\d{2}\/\d{4}$/);
    expect(ad.expiration).toEqual({ previousDate: plusDays(45), newDate: newEnd });
    // Calendário: o vencimento ANTIGO sumiu, o novo existe UMA vez, com os 5 alertas; nada duplicado.
    const ev = await expiryEvents(cid);
    expect(ev.map((e) => e.event_date)).not.toContain(plusDays(45));
    expect(ev.filter((e) => e.alert_offset_days === 0).map((e) => e.event_date)).toEqual([newEnd]);
    expect(ev).toHaveLength(6);
    const cal = await mgr.departmentOperation.calendar({ from: TODAY, to: plusDays(100) });
    expect(cal.events.filter((e: any) => e.referenceId === cid && e.alertOffsetDays === 0)).toHaveLength(1);
    expect((await mgr.contractWorkspace.loadContract({ contractId: cid })).expiration?.endDate).toBe(newEnd);
    // KPI: o contrato conta UMA vez (janela de 90 dias).
    expect(((await mgr.departmentOperation.dashboard({ today: TODAY })) as any).indicators.contractsExpiring).toBe(1);
    // Replay do comando: mesmo aditivo, sem segunda linha, sem novo evento.
    const again = await mgr.contractWorkspace.createAddendum(adInput);
    expect(again.addendum.id).toBe(ad.addendum.id);
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE organization_id = ? AND contract_id = ?", [ORG, cid])).toBe(3);
    expect(await expiryEvents(cid)).toHaveLength(6);
    // Timeline: reagendamento auditado com origem → destino.
    expect(await n("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'vigencia_reagendada' AND reference_id = ?", [ORG, cid])).toBe(1);

    // 4) Termo exportado (DOCX e PDF) com a numeração, a data e o histórico DECLARADO.
    const termo = (await rows<{ id: string }>("SELECT id FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'aditivo'", [ORG, cid]))[0];
    expect(termo).toBeTruthy();
    for (const format of ["docx", "pdf"] as const) {
      const out = await mgr.documentEngine.exportInstitutional({ documentId: termo.id, format });
      expect(out.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      const buf = lastStored(format);
      expect(format === "docx" ? isDocx(buf) : isPdf(buf)).toBe(true);
    }
    const text = (await mammoth.extractRawText({ buffer: lastStored("docx") })).value;
    expect(text).toMatch(/Termo Aditivo nº 3/);
    expect(text).toMatch(/término da vigência em \d{2}\/\d{2}\/\d{4}/);
    expect(text).toMatch(/Das alterações anteriores/);
    expect(text).toMatch(/Termo Aditivo nº 1.*DECLARADO pelo usuário/);
    expect(text).toMatch(/Termo Aditivo nº 2/);

    // 5) Aditivo de VALOR exige parecer: a vigência NÃO é mexida; nenhum parecer é produzido pelo sistema.
    const valor = await mgr.contractWorkspace.createAddendum({ idempotencyKey: `lc-j5-val-${RUN}`, contractId: cid, addendumType: "valor", justification: "Acréscimo de valor (sintético).", newValue: 52000 });
    expect(valor.requiresLegalOpinion).toBe(true);
    expect(valor.addendum).toMatchObject({ sequence: 4, status: "aguardando_parecer" });
    expect((await expiryEvents(cid)).filter((e) => e.alert_offset_days === 0).map((e) => e.event_date)).toEqual([newEnd]);

    // 6) Tenant: outro órgão não vê a vigência nem adita.
    expect((await (await caller(U.managerB, ORG_B)).contractWorkspace.loadContract({ contractId: cid })).workspace).toBeNull();
    expect((await err((await caller(U.managerB, ORG_B)).contractWorkspace.createAddendum({ ...adInput, idempotencyKey: `lc-j5-adb-${RUN}` })))?.code).toBe("NOT_FOUND");
  }, 300_000);

  it("J6 — contrato externo já monitorado vira contrato completo SEM alertas duplicados e sem contar duas vezes no indicador", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const end = plusDays(30);
    const { record } = await op.operationRecord.createRecord({ recordType: "contrato_externo", origin: "externa", number: `CE-J6-${RUN}`, object: "Locação de veículos (sintético)", expirationDate: end });
    const before = await mgr.departmentOperation.dashboard({ today: TODAY });
    const countBefore = (before as any).indicators.contractsExpiring;
    expect(await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, record.id])).toBe(6);

    // Promoção para contrato completo SEM informar o término: o que o registro monitorava é reaproveitado e TRANSFERIDO.
    const r = await mgr.contractWorkspace.registerInForceContract({ idempotencyKey: `lc-j6-${RUN}`, contractNumber: `CT-J6-${RUN}`, contractor: "Locadora Sintética", term: "12 meses", legacyRecordId: record.id });
    expect(r.legacyRecord).toMatchObject({ id: record.id, adoptedExpiration: end });
    expect(r.workspace.object).toMatch(/Locação de veículos/);
    expect(await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, record.id])).toBe(0); // alertas do registro retirados
    expect((await expiryEvents(r.workspace.id)).filter((e) => e.alert_offset_days === 0).map((e) => e.event_date)).toEqual([end]);
    expect(await n("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'vigencia_transferida' AND reference_id = ?", [ORG, record.id])).toBe(1);
    // O MESMO contrato conta uma vez: o indicador não mudou (um contrato saiu do registro e entrou no workspace).
    expect(((await mgr.departmentOperation.dashboard({ today: TODAY })) as any).indicators.contractsExpiring).toBe(countBefore);
    const cal = await mgr.departmentOperation.calendar({ from: TODAY, to: plusDays(60) });
    expect(cal.events.filter((e: any) => e.eventType === "vencimento_contrato" && e.alertOffsetDays === 0 && e.eventDate === end)).toHaveLength(1);
    // O registro continua existindo e aponta para o contrato (complementa; nunca duplica).
    expect((await rows("SELECT reference_type, reference_id FROM operation_records WHERE id = ?", [record.id]))[0]).toEqual({ reference_type: "contract_workspace", reference_id: r.workspace.id });
  }, 120_000);

  it("J7 — parecer: o pedido pelo contrato vira solicitação institucional; o sistema não emite parecer nem decisão jurídica, e as demais jornadas seguem", async () => {
    const mgr = await caller(U.manager);
    const op = await caller(U.operator);
    const contract = (await rows<{ id: string }>("SELECT id FROM contract_workspaces WHERE organization_id = ? AND contract_number = ?", [ORG, `CT-J5-${RUN}`]))[0];
    const reqsBefore = await n("SELECT COUNT(*) n FROM institutional_requests WHERE organization_id = ?", [ORG]);
    const opinionDocsBefore = await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type LIKE '%parecer%'", [ORG]);
    const out = await op.contractWorkspace.requestLegalOpinion({ contractId: contract.id, requestType: "LEGAL_OPINION_INITIAL" });
    expect(out.status).toBe("aguardando_parecer");
    expect(await n("SELECT COUNT(*) n FROM institutional_requests WHERE organization_id = ?", [ORG])).toBe(reqsBefore + 1);
    // Nenhum parecer foi produzido: sem resposta, sem documento de parecer, sem decisão institucional jurídica.
    const result = await mgr.contractWorkspace.getLegalOpinion({ requestId: out.requestId });
    expect((result as any).response ?? null).toBeNull();
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type LIKE '%parecer%'", [ORG])).toBe(opinionDocsBefore);
    expect(await n("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [ORG])).toBe(0);
    // Tenant: o outro órgão não lê a solicitação.
    expect(await (await caller(U.managerB, ORG_B)).contractWorkspace.getLegalOpinion({ requestId: out.requestId })).toEqual({
      response: null, institutionalResponse: null, documents: [], legalOpinion: { status: "NOT_GOVERNED", reason: "REQUEST_NOT_FOUND" },
    });
    // A jornada do contrato segue: aditivo de PRAZO (sem parecer) continua possível mesmo com um pedido de parecer em aberto.
    const ad = await mgr.contractWorkspace.createAddendum({ idempotencyKey: `lc-j7-ad-${RUN}`, contractId: contract.id, addendumType: "prazo", justification: "Nova prorrogação (sintético).", newTerm: "36 meses", newEndDate: plusDays(120) });
    expect(ad.addendum.status).toBe("finalizado");
  }, 120_000);

  it("J4 — contratação direta (módulo existente): sem DFD → fundamento → proposta → justificativas → ratificação → contrato por herança confirmada → exportação DOCX/PDF", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const { workspace } = await op.directProcurement.createProcess({ processNumber: `DP-${RUN}`, object: "Aquisição de material de limpeza (sintético)", procurementType: "dispensa", startOption: "sem_dfd" });
    const wsId = workspace.id;
    await op.directProcurement.selectLegalBasis({ workspaceId: wsId, legalBasis: "Art. 75, II, da Lei 14.133/2021" });
    await op.directProcurement.registerProposal({ workspaceId: wsId, supplierName: "Fornecedor Direto Sintético", supplierDocument: "00.000.000/0001-00", proposalValue: 8000 });
    // Sem etapas artificiais: não exige DFD/ETP/TR; a necessidade é registrada na justificativa (aceite humano).
    expect((await err(op.directProcurement.characterizeNeed({ workspaceId: wsId, description: "x" })))?.code).toBe("NOT_IMPLEMENTED");
    const sug = await op.directProcurement.generateJustification({ workspaceId: wsId });
    expect(sug.suggestion).toBeTruthy();
    await op.directProcurement.acceptJustification({ workspaceId: wsId, need: "Necessidade sintética de material de limpeza", publicInterest: "Interesse público sintético", motivation: "Motivação sintética da contratação", legalFoundation: "Art. 75, II, da Lei 14.133/2021", benefits: "Benefícios sintéticos", alternatives: "Alternativas sintéticas", basedOnSuggestion: false, confirmAccept: true });
    await op.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "manual", justification: "Preço compatível com o praticado, conferido em três cotações (sintético).", referenceValue: 8000, documentReferences: ["Cotação 1"], confirmOfficial: true });
    await op.directProcurement.validateDocuments({ workspaceId: wsId });
    await mgr.directProcurement.ratify({ workspaceId: wsId, decision: "ratificado", decidedByName: "Autoridade Sintética", decidedByRole: "Secretário", decidedAt: TODAY, basisReference: "Portaria 1/2026", justification: "Ratificação sintética de teste.", expectedRevision: 0, idempotencyKey: `lc-j4-rat-${RUN}-1` });

    // Contrato por herança: o servidor PROPÕE (com procedência), a pessoa confirma — nada herdado em silêncio.
    const prop: any = await mgr.contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: wsId });
    expect(prop.kind).toBe("proposal");
    const cand = prop.candidates[0];
    const cw = await mgr.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: wsId, contractNumber: `CT-J4-${RUN}`, sourceProposalId: cand.proposalId, contractor: cand.supplierName, value: cand.value } as any);
    expect(cw.workspace).toMatchObject({ originType: "contratacao_direta", status: "minuta", contractor: "Fornecedor Direto Sintético", value: 8000 });
    await mgr.contractWorkspace.generateDocuments({ contractId: cw.workspace.id, kind: "contrato" });
    // Ativação de minuta segue BLOQUEADA (definição jurídica pendente): aditivo sobre minuta é recusado, nada muda.
    expect((await err(mgr.contractWorkspace.createAddendum({ idempotencyKey: `lc-j4-ad-${RUN}`, contractId: cw.workspace.id, addendumType: "prazo", justification: "x", newTerm: "1 mês" })))?.code).toBe("BAD_REQUEST");
    expect((await rows("SELECT status FROM contract_workspaces WHERE id = ?", [cw.workspace.id]))[0].status).toBe("minuta");
    // Documentos oficiais da jornada exportáveis em DOCX e PDF.
    const docs = await rows<{ id: string; document_type: string }>("SELECT id, document_type FROM official_documents WHERE tenant_id = ? AND (origin = ? OR origin = ?)", [ORG, wsId, cw.workspace.id]);
    expect(docs.map((d) => d.document_type).sort()).toEqual(expect.arrayContaining(["contrato", "justificativa_contratacao", "justificativa_preco"]));
    for (const d of docs) for (const format of ["docx", "pdf"] as const) {
      await mgr.documentEngine.exportInstitutional({ documentId: d.id, format });
      expect(format === "docx" ? isDocx(lastStored(format)) : isPdf(lastStored(format)), `${d.document_type}.${format}`).toBe(true);
    }
    // Tenant: outro órgão não vê a contratação.
    expect((await (await caller(U.managerB, ORG_B)).directProcurement.loadProcess({ workspaceId: wsId })).workspace).toBeNull();
  }, 300_000);
});
