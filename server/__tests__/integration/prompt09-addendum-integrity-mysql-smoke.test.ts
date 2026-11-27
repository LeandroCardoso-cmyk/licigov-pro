/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROMPT 09 — integridade contratual do aditivo em MySQL REAL, routers reais (tenants sintéticos 996921/996922 — nunca a org 1).
 * Evidência de MECANISMO (banco descartável): os pareceres abaixo são produzidos pelo fluxo governado com usuários sintéticos
 * apenas para exercitar as regras; não representam revisão jurídica humana.
 *
 *  A) parecer VINCULADO ao aditivo e à versão do termo: parecer do contrato (sem vínculo) recusado; desfavorável recusado;
 *     com ressalvas exige o registro do atendimento; termo regerado ⇒ parecer da versão anterior recusado; parecer de um
 *     aditivo não serve a outro; termo formalizado não é regerado; outro tenant ⇒ NOT_FOUND.
 *  B) vigência: efeitos atômicos (falha no reagendamento ⇒ nada gravado); replay/retomada de aditivo antigo NÃO restaura
 *     vigência superada; formalizações concorrentes do mesmo contrato ⇒ vencimento coerente com o último commit; redução de
 *     prazo só com confirmação; término anterior à assinatura recusado.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

vi.mock("../../storage", async (orig) => ({
  ...(await orig<typeof import("../../storage")>()),
  assertStorageUsable: () => undefined,
  storagePut: async (key: string) => ({ key, url: `memory://${key}` }),
  storageSignedUrl: async (key: string) => ({ key, url: `memory://${key}` }),
}));
const fail = vi.hoisted(() => ({ reschedule: false }));
vi.mock("../../services/operationRecordService", async (orig) => {
  const actual = await orig<typeof import("../../services/operationRecordService")>();
  return {
    ...actual,
    rescheduleExpiration: (async (...args: Parameters<typeof actual.rescheduleExpiration>) => {
      if (fail.reschedule) { fail.reschedule = false; throw new Error("falha simulada no reagendamento"); }
      return actual.rescheduleExpiration(...args);
    }) as typeof actual.rescheduleExpiration,
  };
});

import { runMigrations } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const ORG = 996921;
const ORG_B = 996922;
const RUN = Date.now().toString(36);
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const plusDays = (d: number) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const YESTERDAY = plusDays(-1);

let conn: mysql.Connection;
const U = { manager: 0, operator: 0, lawyer: 0, managerB: 0 };
let seq = 0;

async function caller(userId: number, org = ORG) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `p9-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `corr-p9-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}
const key = (tag: string) => `p9-${tag}-${RUN}-${++seq}`;

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["official_document_artifacts", "tenant_id"], ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
      ["contract_addenda", "organization_id"], ["contract_ws_apostilles", "organization_id"], ["contract_ws_documents", "organization_id"],
      ["contract_workspaces", "organization_id"], ["operational_events", "organization_id"], ["operational_timeline", "organization_id"],
      ["operation_records", "organization_id"], ["legal_opinion_workspaces", "organization_id"], ["legal_opinion_drafts", "organization_id"],
      ["legal_opinion_versions", "organization_id"], ["legal_opinion_history", "organization_id"], ["lawyer_assignments", "organization_id"],
      ["institutional_requests", "organization_id"], ["institutional_responses", "organization_id"], ["request_assignments", "organization_id"],
      ["request_timelines", "organization_id"], ["request_notifications", "organization_id"], ["document_references", "organization_id"],
      ["ai_execution_audits", "organization_id"], ["process_timeline", "organization_id"], ["idempotency_keys", "organizationId"],
      ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("PROMPT 09 — integridade do aditivo: parecer vinculado, vigência atômica, replay e concorrência (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const org of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Órgão Sintético P9 ${org}`, `p9-sintetico-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`p9-${k}-${RUN}`, `Sintético ${k}`, `p9-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG, U.manager, "manager"], [ORG, U.operator, "operator"], [ORG, U.lawyer, "operator"], [ORG_B, U.managerB, "manager"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`p9-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  async function newContract(tag: string, endDate: string) {
    const r = await (await caller(U.manager)).contractWorkspace.registerInForceContract({
      idempotencyKey: key(`ct-${tag}`), contractNumber: `CT-P9-${tag}-${RUN}`, contractor: "Fornecedor Sintético P9", object: `Objeto sintético ${tag}`,
      term: "12 meses", value: 100000, endDate,
    });
    return r.workspace.id as string;
  }
  async function newAddendum(cid: string, type: "prazo" | "valor", over: Record<string, unknown> = {}) {
    const r = await (await caller(U.manager)).contractWorkspace.createAddendum({
      idempotencyKey: key(`ad-${type}`), contractId: cid, addendumType: type, justification: `Aditivo sintético de ${type}.`,
      ...(type === "valor" ? { newValue: 110000 } : {}), ...over,
    });
    return r.addendum as { id: string; sequence: number; status: string };
  }
  /** Fluxo governado do Parecer Jurídico (usuário sintético; evidência de mecanismo). */
  async function issueOpinion(requestId: string, conclusionType: "favoravel" | "desfavoravel" | "com_ressalvas") {
    const lo = (await caller(U.lawyer)).legalOpinionWorkspace;
    const { workspace } = await lo.receiveRequest({ requestId });
    await lo.createDraft({ workspaceId: workspace.id, opinionType: "LEGAL_OPINION_INITIAL", report: "Relatório sintético.", foundation: "Art. 124 da Lei 14.133/2021.", conclusion: `Conclusão sintética (${conclusionType}).`, conclusionType });
    await lo.signOpinion({ workspaceId: workspace.id, method: "manual", idempotencyKey: key("sig") });
    await lo.returnOpinion({ workspaceId: workspace.id });
  }
  const expiration = async (cid: string) => (await rows<{ d: string }>(
    "SELECT event_date d FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'vencimento_contrato' AND alert_offset_days = 0", [ORG, cid]))
    .map((r) => String(r.d).slice(0, 10));
  const addendumStatus = async (id: string) => (await rows<{ status: string }>("SELECT status FROM contract_addenda WHERE id = ?", [id]))[0]?.status;
  const contractStatus = async (cid: string) => (await rows<{ status: string }>("SELECT status FROM contract_workspaces WHERE id = ?", [cid]))[0]?.status;

  it("A — parecer vinculado ao aditivo e à versão do termo; incompatíveis recusados; termo formalizado congelado", async () => {
    const cid = await newContract("a", plusDays(200));
    const mgr = await caller(U.manager);
    const op = await caller(U.operator);
    const A = await newAddendum(cid, "valor");
    const B = await newAddendum(cid, "valor");
    expect(A.status).toBe("aguardando_parecer");
    const form = { contractId: cid, addendumId: A.id, signedOn: YESTERDAY, formalizationReference: "Termo Aditivo nº 1 (sintético)" };

    // 1) Parecer do CONTRATO (sem vínculo ao aditivo), mesmo governado e favorável ⇒ recusado (data posterior não basta).
    const generic = await (await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid });
    await issueOpinion(generic.requestId, "favoravel");
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: generic.requestId, idempotencyKey: key("f") })))?.message).toMatch(/ADDENDUM_LEGAL_OPINION_NOT_BOUND/);

    // 2) Parecer VINCULADO: o servidor fixa aditivo + versão vigente do termo; desfavorável ⇒ recusado.
    const r1 = await (await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: A.id });
    const [req1] = await rows<{ reference_document_id: string }>("SELECT reference_document_id FROM institutional_requests WHERE id = ?", [r1.requestId]);
    expect(req1.reference_document_id).toBe(A.id);
    const refs = await rows<{ document_id: string; version: number }>("SELECT document_id, version FROM document_references WHERE request_id = ?", [r1.requestId]);
    const [term1] = await rows<{ id: string; version: number }>("SELECT id, version FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'aditivo' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.instrumentId')) = ? ORDER BY version DESC LIMIT 1", [ORG, cid, A.id]);
    expect(refs).toEqual([{ document_id: term1.id, version: term1.version }]);
    expect((await mgr.contractWorkspace.listAddendumLegalOpinions({ contractId: cid, addendumId: A.id })).map((o) => [o.requestId, o.eligible])).toEqual([[r1.requestId, false]]);
    await issueOpinion(r1.requestId, "desfavoravel");
    // Auditoria P1 — reaproveitar o MESMO correlationId nunca reabre nem estende a solicitação já respondida.
    const sameCorr = await caller(U.operator);
    const first = await sameCorr.contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: B.id });
    expect((await err(sameCorr.contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: B.id })))?.message).toMatch(/REQUEST_ALREADY_REGISTERED/);
    expect((await rows("SELECT id FROM document_references WHERE request_id = ?", [first.requestId])).length).toBe(1);
    const [st1] = await rows<{ status: string }>("SELECT status FROM institutional_requests WHERE id = ?", [r1.requestId]);
    expect(st1.status).not.toBe("PENDING"); // respondida continua respondida
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r1.requestId, idempotencyKey: key("f") })))?.message).toMatch(/ADDENDUM_LEGAL_OPINION_UNFAVORABLE/);

    // 3) Com ressalvas: sem o registro do atendimento ⇒ recusado (nunca presumido).
    const r2 = await (await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: A.id });
    await issueOpinion(r2.requestId, "com_ressalvas");
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r2.requestId, idempotencyKey: key("f") })))?.message).toMatch(/ADDENDUM_OPINION_RESERVATIONS_UNADDRESSED/);

    // 4) Termo REGERADO depois do parecer ⇒ o parecer examinou a versão anterior: recusado.
    await (await caller(U.operator)).contractWorkspace.generateDocuments({ contractId: cid, kind: "aditivo", refId: A.id });
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r2.requestId, reservationsAddressed: "Cláusula ajustada conforme a ressalva (sintético).", idempotencyKey: key("f") })))?.message).toMatch(/ADDENDUM_LEGAL_OPINION_STALE_TERM/);
    expect(await addendumStatus(A.id)).toBe("aguardando_parecer");
    expect(await contractStatus(cid)).toBe("vigente");

    // 5) Parecer sobre a versão vigente, com ressalvas + registro ⇒ formaliza; evento fixa termo, parecer, conclusão e declaração.
    const r3 = await (await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: A.id });
    await issueOpinion(r3.requestId, "com_ressalvas");
    const eligible = await mgr.contractWorkspace.listAddendumLegalOpinions({ contractId: cid, addendumId: A.id });
    expect(eligible.filter((o) => o.eligible).map((o) => o.requestId)).toEqual([r3.requestId]);
    expect((await err((await caller(U.managerB, ORG_B)).contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r3.requestId, idempotencyKey: key("fb") })))?.code).toBe("NOT_FOUND");
    expect((await err(op.contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r3.requestId, idempotencyKey: key("fo") })))?.code).toBe("FORBIDDEN");
    const ok = await (await caller(U.manager)).contractWorkspace.formalizeAddendum({ ...form, legalOpinionRequestId: r3.requestId, reservationsAddressed: "Cláusula ajustada conforme a ressalva (sintético).", idempotencyKey: key("f") });
    expect(ok.addendum.status).toBe("finalizado");
    expect(ok.termDocument?.version).toBe(2);
    expect(await contractStatus(cid)).toBe("aditado");
    const [ev] = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND summary LIKE '%FORMALIZADO%'", [ORG, A.id]);
    expect(ev.summary).toContain(`v2`);
    expect(ev.summary).toContain(`parecer ${r3.requestId} (conclusão: com_ressalvas)`);
    expect(ev.summary).toContain("DECLARADO por quem formaliza");

    // 6) Termo formalizado não é regerado; parecer de A não serve a B; nova solicitação para A (finalizado) recusada.
    expect((await err((await caller(U.operator)).contractWorkspace.generateDocuments({ contractId: cid, kind: "aditivo", refId: A.id })))?.message).toMatch(/ADDENDUM_TERM_FROZEN/);
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form, addendumId: B.id, legalOpinionRequestId: r3.requestId, idempotencyKey: key("fB") })))?.message).toMatch(/ADDENDUM_LEGAL_OPINION_NOT_BOUND/);
    expect((await err((await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: A.id })))?.message).toMatch(/ADDENDUM_NOT_FORMALIZABLE/);
    expect(await addendumStatus(B.id)).toBe("aguardando_parecer");
  }, 300_000);

  it("A — formalizações CONCORRENTES do mesmo aditivo com o mesmo parecer: exatamente uma aplica efeitos", async () => {
    const cid = await newContract("ac", plusDays(200));
    const mgr = await caller(U.manager);
    const A = await newAddendum(cid, "valor");
    const r = await (await caller(U.operator)).contractWorkspace.requestLegalOpinion({ contractId: cid, addendumId: A.id });
    await issueOpinion(r.requestId, "favoravel");
    const base = { contractId: cid, addendumId: A.id, signedOn: YESTERDAY, legalOpinionRequestId: r.requestId };
    const results = await Promise.allSettled([
      mgr.contractWorkspace.formalizeAddendum({ ...base, formalizationReference: "Termo Aditivo nº 1 — via 1", idempotencyKey: key("c1") }),
      mgr.contractWorkspace.formalizeAddendum({ ...base, formalizationReference: "Termo Aditivo nº 1 — via 2", idempotencyKey: key("c2") }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason?.message)).toMatch(/ADDENDUM_FORMALIZATION_CONFLICT|ADDENDUM_ALREADY_FORMALIZED|INSTRUMENT_STATUS|CONFLICT/);
    expect((await rows("SELECT id FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND summary LIKE '%FORMALIZADO%'", [ORG, A.id])).length).toBe(1);
  }, 180_000);

  it("B — vigência: efeitos atômicos, replay não restaura vigência superada, concorrência coerente, redução só confirmada", async () => {
    const E0 = plusDays(100);
    const cid = await newContract("b", E0);
    const mgr = await caller(U.manager);
    expect(await expiration(cid)).toEqual([E0]);
    const form = (id: string, ref: string) => ({ contractId: cid, addendumId: id, signedOn: YESTERDAY, formalizationReference: ref });

    // 1) Falha no reagendamento DENTRO da transação ⇒ nada gravado (aditivo em minuta, status e vencimento intactos).
    const A = await newAddendum(cid, "prazo", { newEndDate: plusDays(400) });
    expect(A.status).toBe("minuta");
    fail.reschedule = true;
    expect(await err(mgr.contractWorkspace.formalizeAddendum({ ...form(A.id, "Termo A"), idempotencyKey: key("fa") }))).not.toBeNull();
    expect(await addendumStatus(A.id)).toBe("minuta");
    expect(await contractStatus(cid)).toBe("vigente");
    expect(await expiration(cid)).toEqual([E0]);
    expect((await rows("SELECT id FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND summary LIKE '%FORMALIZADO%'", [ORG, A.id])).length).toBe(0);

    // 2) Nova tentativa ⇒ efeitos aplicados juntos.
    const fa = await mgr.contractWorkspace.formalizeAddendum({ ...form(A.id, "Termo A"), idempotencyKey: key("fa2") });
    expect(fa.expiration).toEqual({ previousDate: E0, newDate: plusDays(400) });
    expect(await expiration(cid)).toEqual([plusDays(400)]);

    // 3) Aditivo posterior B move a vigência; REPLAY/retomada de A (outra chave, mesma referência) NÃO a restaura.
    const B = await newAddendum(cid, "prazo", { newEndDate: plusDays(800) });
    await mgr.contractWorkspace.formalizeAddendum({ ...form(B.id, "Termo B"), idempotencyKey: key("fb") });
    expect(await expiration(cid)).toEqual([plusDays(800)]);
    const replay = await mgr.contractWorkspace.formalizeAddendum({ ...form(A.id, "Termo A"), idempotencyKey: key("fa3") });
    expect(replay).toMatchObject({ resumed: true, expiration: null });
    expect(await expiration(cid)).toEqual([plusDays(800)]);
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form(A.id, "Outro termo"), idempotencyKey: key("fa4") })))?.message).toMatch(/ADDENDUM_ALREADY_FORMALIZED/);

    // 4) Duas formalizações CONCORRENTES no mesmo contrato (C → +1000, D → +1200): serializadas pelo lock. Se C commitar
    //    primeiro, D prorroga a partir dela; se D commitar primeiro, C vira REDUÇÃO não confirmada e é recusada (fica minuta).
    //    Em qualquer ordem: vencimento final = +1200, um único conjunto de alertas, nunca um estado intercalado.
    const C = await newAddendum(cid, "prazo", { newEndDate: plusDays(1000) });
    const D = await newAddendum(cid, "prazo", { newEndDate: plusDays(1200) });
    const [rc, rd] = await Promise.allSettled([
      mgr.contractWorkspace.formalizeAddendum({ ...form(C.id, "Termo C"), idempotencyKey: key("fc") }),
      mgr.contractWorkspace.formalizeAddendum({ ...form(D.id, "Termo D"), idempotencyKey: key("fd") }),
    ]);
    expect(rd.status).toBe("fulfilled");
    const dExp = (rd as PromiseFulfilledResult<any>).value.expiration;
    if (rc.status === "fulfilled") {
      expect((rc as PromiseFulfilledResult<any>).value.expiration).toEqual({ previousDate: plusDays(800), newDate: plusDays(1000) });
      expect(dExp).toEqual({ previousDate: plusDays(1000), newDate: plusDays(1200) });
    } else {
      expect(String(rc.reason?.message)).toMatch(/ADDENDUM_TERM_REDUCTION_UNCONFIRMED/);
      expect(dExp).toEqual({ previousDate: plusDays(800), newDate: plusDays(1200) });
      expect(await addendumStatus(C.id)).toBe("minuta");
    }
    expect(await expiration(cid)).toEqual([plusDays(1200)]);
    const alerts = await rows<{ n: number }>("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'vencimento_contrato'", [ORG, cid]);
    expect(Number(alerts[0].n)).toBe(6); // vencimento + 90/60/30/15/7d de UM único término

    // 5) Redução de prazo: sem confirmação ⇒ recusada, nada muda; com confirmação ⇒ aplicada e registrada.
    const current = (await expiration(cid))[0];
    const R = await newAddendum(cid, "prazo", { newEndDate: plusDays(500) });
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form(R.id, "Termo R"), idempotencyKey: key("fr") })))?.message).toMatch(/ADDENDUM_TERM_REDUCTION_UNCONFIRMED/);
    expect(await addendumStatus(R.id)).toBe("minuta");
    expect(await expiration(cid)).toEqual([current]);
    const red = await mgr.contractWorkspace.formalizeAddendum({ ...form(R.id, "Termo R"), termReductionConfirmed: true, idempotencyKey: key("fr2") });
    expect(red.expiration).toEqual({ previousDate: current, newDate: plusDays(500) });
    const [ev] = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE organization_id = ? AND ref_id = ? AND summary LIKE '%FORMALIZADO%'", [ORG, R.id]);
    expect(ev.summary).toContain("REDUÇÃO de prazo confirmada");

    // 6) Término proposto anterior à assinatura ⇒ recusado antes de qualquer escrita.
    const P = await newAddendum(cid, "prazo", { newEndDate: plusDays(-10) });
    expect((await err(mgr.contractWorkspace.formalizeAddendum({ ...form(P.id, "Termo P"), termReductionConfirmed: true, idempotencyKey: key("fp") })))?.message).toMatch(/ADDENDUM_END_DATE_BEFORE_SIGNATURE/);
    expect(await addendumStatus(P.id)).toBe("minuta");
  }, 300_000);
});
