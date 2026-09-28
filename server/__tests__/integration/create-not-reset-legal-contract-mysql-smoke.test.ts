/**
 * R3 / PR-06 — Create ≠ Reset: PARECER (SEM-006) e CONTRATO (SEM-007) — smoke contra MySQL REAL, router real.
 * Só roda com DATABASE_URL definido (pulado sem banco).
 *
 * R3.1 — reproduz, na fronteira de persistência, os dois resets P0 do inventário semântico:
 *  - SEM-006: `legalOpinionWorkspace.createDraft` sobre parecer já ASSINADO regravava o rascunho (upsert por
 *    hash(org, workspace, tipo)): signed→0, version→1, texto novo, versão v1 sobrescrita e documento oficial
 *    novo — ANTES de `transitionLegalStage` lançar SIGNED→DRAFT (o usuário via erro, mas o dado já estava corrompido).
 *  - SEM-007: criação canônica de contrato fazia upsert por hash(org, origem, número): contrato VIGENTE voltava a
 *    "minuta" com contratado/valor/prazo de outra criação; 2º import sem número ("IMPORTADO") sobrescrevia o 1º.
 *
 * Contrato "padrão R3" verificado (R3.2):
 *  - criação sobre chave natural existente no MESMO tenant ⇒ CONFLICT com mensagem pt-BR estável + token estável
 *    (`LEGAL_OPINION_ALREADY_SIGNED`, `LEGAL_OPINION_ALREADY_EXISTS`, `LEGAL_OPINION_STAGE_INVALID`,
 *    `CONTRACT_ALREADY_EXISTS`) e ZERO mutação do registro existente e dos dependentes (byte a byte);
 *  - convergência (devolve o existente, SEM escrita) só para retry idempotente da MESMA criação: mesmo ator +
 *    mesmo payload normalizado + registro ainda no estado que a criação produz (parecer: rascunho v1 não
 *    assinado; contrato: minuta);
 *  - dupla criação concorrente (Promise.all) ⇒ exatamente UMA linha e UM conjunto de dependentes;
 *  - mesmo número/chave em outro tenant é independente; RBAC/tenant inalterados.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { requestInstitutionalReview } from "../../services/institutionalRequestService";

const DB = process.env.DATABASE_URL;
const ORG_A = 960601;
const ORG_B = 960602;
const RUN = Date.now().toString(36);

describe.skipIf(!DB)("R3 / PR-06 — Create ≠ Reset: parecer e contrato (MySQL real, router real)", () => {
  let conn: mysql.Connection;
  let lawyerA: number, lawyerA2: number, requesterA: number, lawyerB: number, outsider: number;
  let seq = 0;

  const q = async (sql: string, p: unknown[] = []) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, p);
    return rows;
  };
  const count = async (sql: string, p: unknown[]) => Number((await q(sql, p))[0].n);

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId: `r3-06-${userId}-${org}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  /** Executa a tentativa SEM abortar o teste: o estado persistido é verificado antes do código de erro (evidência R3.1). */
  const attempt = async (fn: () => Promise<unknown>): Promise<{ ok: boolean; code: string; message: string }> => {
    try { await fn(); return { ok: true, code: "", message: "" }; }
    catch (e: any) { return { ok: false, code: String(e?.code ?? ""), message: String(e?.message ?? "") }; }
  };
  const errOf = async (fn: () => Promise<unknown>): Promise<{ code: string; message: string }> => {
    const r = await attempt(fn);
    if (r.ok) throw new Error("era esperado erro, mas a chamada teve sucesso");
    return r;
  };

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [org, `Org R3-06 ${org} ${RUN}`, `org-r306-${org}-${RUN}`]);
    }
    async function user(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`r306-${tag}-${RUN}`, `R3-06 ${tag}`, `r306-${tag}-${RUN}@teste.local`]);
      return r.insertId;
    }
    const member = (org: number, userId: number, role = "operator") =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    lawyerA = await user("lawyer-a"); lawyerA2 = await user("lawyer-a2"); requesterA = await user("req-a");
    lawyerB = await user("lawyer-b"); outsider = await user("outsider");
    await member(ORG_A, lawyerA); await member(ORG_A, lawyerA2); await member(ORG_A, requesterA);
    await member(ORG_B, lawyerB);
    // outsider: propositalmente SEM membership em ORG_A (só em ORG_B).
    await member(ORG_B, outsider);
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    for (const org of [ORG_A, ORG_B]) {
      for (const t of ["institutional_requests", "institutional_responses", "request_assignments", "request_timelines",
        "request_notifications", "document_references", "official_documents", "official_document_timeline",
        "legal_opinion_workspaces", "legal_opinion_drafts", "legal_opinion_versions", "legal_opinion_history",
        "lawyer_assignments", "contract_workspaces", "imported_contracts", "process_timeline"]) {
        await del(`DELETE FROM \`${t}\` WHERE organization_id = ?`, [org]);
        await del(`DELETE FROM \`${t}\` WHERE organizationId = ?`, [org]);
        await del(`DELETE FROM \`${t}\` WHERE tenant_id = ?`, [org]);
      }
      await del(`DELETE FROM idempotency_keys WHERE organizationId = ?`, [org]);
      await del(`DELETE FROM organization_members WHERE organizationId = ?`, [org]);
    }
    const users = [lawyerA, lawyerA2, requesterA, lawyerB, outsider].filter(Boolean);
    if (users.length) await del(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(",")})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  // ─── Parecer ──────────────────────────────────────────────────────────────────

  /** Abre um workspace de parecer real (Institutional Request Engine → receiveRequest) e devolve o id. */
  async function openOpinionWorkspace(org: number, lawyer: number, requester: number): Promise<string> {
    const tag = `${org % 10}${++seq}`;
    const { request } = await requestInstitutionalReview({
      organizationId: org, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico",
      requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: `p-${RUN}-${tag}`.slice(0, 20),
      title: `Parecer R3-06 ${tag}`, priority: "alta", requestedBy: requester, correlationId: `corr-r306-${tag}`,
    });
    const c = await caller(lawyer, org);
    const { workspace } = await c.legalOpinionWorkspace.receiveRequest({ requestId: request.id });
    return workspace.id;
  }

  const DRAFT_PAYLOAD = {
    opinionType: "LEGAL_OPINION_INITIAL" as const,
    report: "Relatório: análise da minuta de edital.",
    foundation: "Fundamentação: art. 53 da Lei 14.133/2021.",
    conclusion: "Pela regularidade, com ressalvas.",
    conclusionType: "com_ressalvas" as const,
  };

  /** Fotografia BYTE A BYTE do parecer e de todos os dependentes (rascunho, versões, workspace, histórico, oficiais). */
  async function opinionSnapshot(org: number, wsId: string): Promise<string> {
    const parts = await Promise.all([
      q(`SELECT * FROM legal_opinion_drafts WHERE workspace_id = ? AND organization_id = ? ORDER BY id`, [wsId, org]),
      q(`SELECT * FROM legal_opinion_versions WHERE workspace_id = ? AND organization_id = ? ORDER BY id`, [wsId, org]),
      q(`SELECT * FROM legal_opinion_workspaces WHERE id = ? AND organization_id = ?`, [wsId, org]),
      q(`SELECT * FROM legal_opinion_history WHERE workspace_id = ? AND organization_id = ? ORDER BY event_order, id`, [wsId, org]),
      q(`SELECT * FROM official_documents WHERE origin = ? AND tenant_id = ? ORDER BY id`, [wsId, org]),
      q(`SELECT t.* FROM official_document_timeline t JOIN official_documents d ON d.id = t.document_id AND d.tenant_id = t.tenant_id
          WHERE d.origin = ? AND d.tenant_id = ? ORDER BY t.id`, [wsId, org]),
    ]);
    return JSON.stringify(parts);
  }
  const draftRow = async (org: number, wsId: string) =>
    (await q(`SELECT * FROM legal_opinion_drafts WHERE workspace_id = ? AND organization_id = ? ORDER BY id`, [wsId, org]));

  it("L1 (R3.1/SEM-006) — createDraft sobre parecer ASSINADO ⇒ CONFLICT LEGAL_OPINION_ALREADY_SIGNED; parecer intocado byte a byte", async () => {
    const wsId = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const c = await caller(lawyerA, ORG_A);
    await c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD });
    await c.legalOpinionWorkspace.updateOpinion({ workspaceId: wsId, report: "Relatório REVISADO pelo procurador." });
    const signed = await c.legalOpinionWorkspace.signOpinion({ workspaceId: wsId, idempotencyKey: `sign-${RUN}-l1-${wsId}`.slice(0, 64) });
    expect(signed.draft.signed).toBe(true);
    const before = await opinionSnapshot(ORG_A, wsId);
    const beforeDraft = (await draftRow(ORG_A, wsId))[0];
    expect(beforeDraft.signed).toBe(1);
    expect(beforeDraft.version).toBe(2);

    // Nova "criação" com texto diferente (ex.: aba antiga com hasDraft=false) — a que corrompia o parecer.
    const e1 = await attempt(() => c.legalOpinionWorkspace.createDraft({
      workspaceId: wsId, opinionType: "LEGAL_OPINION_INITIAL", report: "Texto NOVO que apagaria o assinado", conclusionType: "desfavoravel",
    }));
    // Estado PRIMEIRO (evidência R3.1): o parecer assinado continua assinado, na v2, com o texto revisado.
    const afterFirst = (await draftRow(ORG_A, wsId))[0];
    expect({ signed: afterFirst.signed, version: afterFirst.version, status: afterFirst.status, report: afterFirst.report })
      .toEqual({ signed: 1, version: 2, status: "assinado", report: "Relatório REVISADO pelo procurador." });
    expect(await opinionSnapshot(ORG_A, wsId)).toBe(before);
    expect(e1.ok).toBe(false);
    expect(e1.code).toBe("CONFLICT");
    expect(e1.message).toContain("LEGAL_OPINION_ALREADY_SIGNED");
    expect(e1.message).toMatch(/assinado/i);

    // O MESMO payload da criação original também não "reconverge" um parecer assinado.
    const e2 = await errOf(() => c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }));
    expect(e2.code).toBe("CONFLICT");
    expect(e2.message).toContain("LEGAL_OPINION_ALREADY_SIGNED");

    // Outro tipo de parecer no mesmo workspace assinado — também recusado, sem escrita.
    const e3 = await errOf(() => c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD, opinionType: "LEGAL_OPINION_FINAL" }));
    expect(e3.code).toBe("CONFLICT");
    expect(e3.message).toContain("LEGAL_OPINION_ALREADY_SIGNED");

    // Outro procurador do mesmo órgão — idem.
    const c2 = await caller(lawyerA2, ORG_A);
    const e4 = await errOf(() => c2.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD, report: "outro" }));
    expect(e4.code).toBe("CONFLICT");

    // Edição direta também continua bloqueada (domínio) — e nada muda.
    await errOf(() => c.legalOpinionWorkspace.updateOpinion({ workspaceId: wsId, report: "edição pós-assinatura" }));

    expect(await opinionSnapshot(ORG_A, wsId)).toBe(before);
    const after = (await draftRow(ORG_A, wsId));
    expect(after).toHaveLength(1);
    expect(after[0].signed).toBe(1);
    expect(after[0].version).toBe(2);
    expect(after[0].report).toBe("Relatório REVISADO pelo procurador.");
  }, 30_000);

  it("L2 — retry idempotente (mesmo ator + mesmo payload, rascunho v1 não assinado) converge: mesmo parecer, ZERO escrita", async () => {
    const wsId = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const c = await caller(lawyerA, ORG_A);
    const first = await c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD });
    const before = await opinionSnapshot(ORG_A, wsId);
    const retry = await c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD });
    expect(retry.draft.id).toBe(first.draft.id);
    expect(retry.draft.version).toBe(1);
    expect(retry.draft.report).toBe(DRAFT_PAYLOAD.report);
    expect(retry.workspace.currentStage).toBe("DRAFT");
    // Normalização: arrays omitidos ≡ arrays vazios; conclusionType omitido ≡ null (mesmo payload normalizado).
    const retry2 = await c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD, recommendations: [], reservations: [], attachments: [] });
    expect(retry2.draft.id).toBe(first.draft.id);
    expect(await opinionSnapshot(ORG_A, wsId)).toBe(before);
  }, 30_000);

  it("L3 — payload diferente / outro ator / após edição ⇒ CONFLICT LEGAL_OPINION_ALREADY_EXISTS, ZERO mutação", async () => {
    const wsId = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const c = await caller(lawyerA, ORG_A);
    await c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD });
    const before = await opinionSnapshot(ORG_A, wsId);

    for (const variant of [
      { ...DRAFT_PAYLOAD, report: "Relatório diferente" },
      { ...DRAFT_PAYLOAD, conclusionType: "favoravel" as const },
      { ...DRAFT_PAYLOAD, reservations: ["ressalva nova"] },
      { ...DRAFT_PAYLOAD, opinionType: "LEGAL_OPINION_FINAL" as const },
    ]) {
      const e = await errOf(() => c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...variant }));
      expect(e.code).toBe("CONFLICT");
      expect(e.message).toContain("LEGAL_OPINION_ALREADY_EXISTS");
      expect(e.message).toMatch(/Já existe um parecer/);
    }
    // Mesmo payload, OUTRO ator ⇒ não é retry da mesma criação.
    const c2 = await caller(lawyerA2, ORG_A);
    const eActor = await errOf(() => c2.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }));
    expect(eActor.code).toBe("CONFLICT");
    expect(eActor.message).toContain("LEGAL_OPINION_ALREADY_EXISTS");
    expect(await opinionSnapshot(ORG_A, wsId)).toBe(before);

    // Após edição humana (v2), o payload ORIGINAL da criação já não converge — e não reseta a v2.
    await c.legalOpinionWorkspace.updateOpinion({ workspaceId: wsId, report: "Relatório v2" });
    const afterEdit = await opinionSnapshot(ORG_A, wsId);
    const eEdited = await errOf(() => c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }));
    expect(eEdited.code).toBe("CONFLICT");
    expect(eEdited.message).toContain("LEGAL_OPINION_ALREADY_EXISTS");
    expect(await opinionSnapshot(ORG_A, wsId)).toBe(afterEdit);
    const row = (await draftRow(ORG_A, wsId))[0];
    expect(row.version).toBe(2);
    expect(row.report).toBe("Relatório v2");
  }, 30_000);

  it("L4 — etapa validada ANTES de qualquer escrita: workspace arquivado recusa createDraft sem gravar rascunho/versão/oficial", async () => {
    const wsId = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const c = await caller(lawyerA, ORG_A);
    await c.legalOpinionWorkspace.archiveOpinion({ workspaceId: wsId });
    const before = await opinionSnapshot(ORG_A, wsId);
    const e = await errOf(() => c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toContain("LEGAL_OPINION_STAGE_INVALID");
    expect(await draftRow(ORG_A, wsId)).toHaveLength(0);
    expect(await opinionSnapshot(ORG_A, wsId)).toBe(before);
  }, 30_000);

  it("L5 — dupla criação concorrente (Promise.all): UM rascunho, UMA versão v1, UM evento, UM oficial", async () => {
    const wsId = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const c = await caller(lawyerA, ORG_A);
    const [r1, r2] = await Promise.all([
      c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }),
      c.legalOpinionWorkspace.createDraft({ workspaceId: wsId, ...DRAFT_PAYLOAD }),
    ]);
    expect(r1.draft.id).toBe(r2.draft.id);
    expect(await draftRow(ORG_A, wsId)).toHaveLength(1);
    expect(await count(`SELECT COUNT(*) n FROM legal_opinion_versions WHERE workspace_id = ? AND organization_id = ?`, [wsId, ORG_A])).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM legal_opinion_history WHERE workspace_id = ? AND organization_id = ? AND event_type = 'draft_created'`, [wsId, ORG_A])).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM official_documents WHERE origin = ? AND tenant_id = ?`, [wsId, ORG_A])).toBe(1);

    // Concorrência com payloads DIFERENTES: um vence, o outro recebe CONFLICT; nenhum sobrescreve o outro.
    const wsId2 = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const settled = await Promise.allSettled([
      c.legalOpinionWorkspace.createDraft({ workspaceId: wsId2, ...DRAFT_PAYLOAD, report: "versão X" }),
      c.legalOpinionWorkspace.createDraft({ workspaceId: wsId2, ...DRAFT_PAYLOAD, report: "versão Y" }),
    ]);
    const ok = settled.filter(s => s.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const ko = settled.filter(s => s.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(String(ko[0].reason?.code)).toBe("CONFLICT");
    const rows = await draftRow(ORG_A, wsId2);
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toBe(ok[0].value.draft.report);
    expect(await count(`SELECT COUNT(*) n FROM legal_opinion_versions WHERE workspace_id = ? AND organization_id = ?`, [wsId2, ORG_A])).toBe(1);
  }, 30_000);

  it("L6 — isolamento: outro tenant não cria/reseta parecer do órgão A (NOT_FOUND, zero escrita); workspaces próprios independentes", async () => {
    const wsA = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const cA = await caller(lawyerA, ORG_A);
    await cA.legalOpinionWorkspace.createDraft({ workspaceId: wsA, ...DRAFT_PAYLOAD });
    const beforeA = await opinionSnapshot(ORG_A, wsA);

    const cB = await caller(lawyerB, ORG_B);
    const e = await errOf(() => cB.legalOpinionWorkspace.createDraft({ workspaceId: wsA, ...DRAFT_PAYLOAD, report: "cross-tenant" }));
    expect(e.code).toBe("NOT_FOUND");
    expect(await opinionSnapshot(ORG_A, wsA)).toBe(beforeA);
    expect(await count(`SELECT COUNT(*) n FROM legal_opinion_drafts WHERE workspace_id = ? AND organization_id = ?`, [wsA, ORG_B])).toBe(0);

    // O mesmo payload num workspace do órgão B é uma criação independente.
    const wsB = await openOpinionWorkspace(ORG_B, lawyerB, lawyerB);
    const rB = await cB.legalOpinionWorkspace.createDraft({ workspaceId: wsB, ...DRAFT_PAYLOAD });
    expect(rB.draft.organizationId).toBe(ORG_B);
    expect(await opinionSnapshot(ORG_A, wsA)).toBe(beforeA);
  }, 30_000);

  it("L7 — RBAC/tenant inalterados: não-membro do órgão é recusado (FORBIDDEN) antes de qualquer escrita", async () => {
    const wsA = await openOpinionWorkspace(ORG_A, lawyerA, requesterA);
    const before = await opinionSnapshot(ORG_A, wsA);
    const cOut = await caller(outsider, ORG_A);
    const e = await errOf(() => cOut.legalOpinionWorkspace.createDraft({ workspaceId: wsA, ...DRAFT_PAYLOAD }));
    expect(e.code).toBe("FORBIDDEN");
    expect(await opinionSnapshot(ORG_A, wsA)).toBe(before);
  }, 30_000);

  // ─── Contrato ─────────────────────────────────────────────────────────────────

  async function contractSnapshot(org: number, id: string): Promise<string> {
    const parts = await Promise.all([
      q(`SELECT * FROM contract_workspaces WHERE id = ? AND organization_id = ?`, [id, org]),
      q(`SELECT * FROM process_timeline WHERE process_id = ? AND organization_id = ? ORDER BY event_order, id`, [id, org]),
      q(`SELECT * FROM imported_contracts WHERE contract_id = ? AND organization_id = ? ORDER BY id`, [id, org]),
    ]);
    return JSON.stringify(parts);
  }
  const contractRow = async (org: number, id: string) =>
    (await q(`SELECT * FROM contract_workspaces WHERE id = ? AND organization_id = ?`, [id, org]))[0];

  it("C1 (R3.1/SEM-007) — criação sobre (origem, número) de contrato VIGENTE ⇒ CONFLICT CONTRACT_ALREADY_EXISTS; contrato intocado", async () => {
    const number = `CT-${RUN}-C1`;
    const c = await caller(lawyerA, ORG_A);
    const { workspace } = await c.contractWorkspace.createFromProcurement({
      processId: `proc-${RUN}-1`, contractNumber: number, contractor: "Fornecedor Original", value: 100_000, term: "12 meses",
    });
    // O contrato passa a VIGENTE (fixture direta — independente do fluxo de edição, fora do escopo da PR-06).
    await conn.execute(`UPDATE contract_workspaces SET status = 'vigente' WHERE id = ? AND organization_id = ?`, [workspace.id, ORG_A]);
    const before = await contractSnapshot(ORG_A, workspace.id);

    // Outro processo, mesmo número — antes: status→minuta, contratado/valor/prazo trocados, origem mantida.
    const e1 = await attempt(() => c.contractWorkspace.createFromProcurement({
      processId: `proc-${RUN}-2`, contractNumber: number, contractor: "Fornecedor Intruso", value: 999_999, term: "60 meses",
    }));
    // Estado PRIMEIRO (evidência R3.1): o contrato vigente não volta a minuta nem troca contratado/valor/prazo.
    const afterFirst = await contractRow(ORG_A, workspace.id);
    expect({ status: afterFirst.status, contractor: afterFirst.contractor, value: afterFirst.value, term: afterFirst.term })
      .toEqual({ status: "vigente", contractor: "Fornecedor Original", value: "100000.00", term: "12 meses" });
    expect(await contractSnapshot(ORG_A, workspace.id)).toBe(before);
    expect(e1.ok).toBe(false);
    expect(e1.code).toBe("CONFLICT");
    expect(e1.message).toContain("CONTRACT_ALREADY_EXISTS");
    expect(e1.message).toMatch(/Já existe um contrato/);
    expect(e1.message).toContain(`(id: ${workspace.id})`);
    // Nem o retry EXATO da criação converge sobre um contrato que já saiu de minuta.
    const e2 = await errOf(() => c.contractWorkspace.createFromProcurement({
      processId: `proc-${RUN}-1`, contractNumber: number, contractor: "Fornecedor Original", value: 100_000, term: "12 meses",
    }));
    expect(e2.code).toBe("CONFLICT");

    expect(await contractSnapshot(ORG_A, workspace.id)).toBe(before);
    const row = await contractRow(ORG_A, workspace.id);
    expect(row.status).toBe("vigente");
    expect(row.contractor).toBe("Fornecedor Original");
    expect(row.origin_process).toBe(`proc-${RUN}-1`);
  }, 30_000);

  it("C2 (R3.1/SEM-007) — 2º import externo sem número (\"IMPORTADO\") ⇒ CONFLICT; o 1º import permanece", async () => {
    const c = await caller(lawyerA, ORG_A);
    const first = await c.contractWorkspace.importExternalContract({ source: "pdf", rawText: `CONTRATADO: Alfa Ltda\nOBJETO: limpeza ${RUN}\nVALOR: R$ 1.000,00` });
    const id = first.workspace.id;
    const before = await contractSnapshot(ORG_A, id);
    const e = await attempt(() => c.contractWorkspace.importExternalContract({ source: "pdf", rawText: `CONTRATADO: Beta SA\nOBJETO: vigilância ${RUN}\nVALOR: R$ 5.000,00` }));
    // Estado PRIMEIRO (evidência R3.1): o 1º import não é sobrescrito pelo 2º.
    expect((await contractRow(ORG_A, id)).contractor).toBe(first.workspace.contractor);
    expect(await contractSnapshot(ORG_A, id)).toBe(before);
    expect(e.ok).toBe(false);
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toContain("CONTRACT_ALREADY_EXISTS");
    expect(await contractSnapshot(ORG_A, id)).toBe(before);
    expect((await contractRow(ORG_A, id)).contractor).toBe(first.workspace.contractor);
    // Reenvio do MESMO texto pelo mesmo ator (retry) converge, sem escrita.
    const retry = await c.contractWorkspace.importExternalContract({ source: "pdf", rawText: `CONTRATADO: Alfa Ltda\nOBJETO: limpeza ${RUN}\nVALOR: R$ 1.000,00` });
    expect(retry.workspace.id).toBe(id);
    expect(await contractSnapshot(ORG_A, id)).toBe(before);
  }, 30_000);

  it("C3 — retry idempotente (mesmo ator + mesmo payload, ainda minuta) converge para Processo e Contratação Direta, ZERO escrita", async () => {
    const c = await caller(lawyerA, ORG_A);
    const p = { processId: `proc-${RUN}-3`, contractNumber: `CT-${RUN}-C3`, contractor: "Gama", value: 5_000, term: "6 meses" };
    const a = await c.contractWorkspace.createFromProcurement(p);
    const beforeA = await contractSnapshot(ORG_A, a.workspace.id);
    const a2 = await c.contractWorkspace.createFromProcurement(p);
    expect(a2.workspace.id).toBe(a.workspace.id);
    expect(a2.workspace.status).toBe("minuta");
    expect(await contractSnapshot(ORG_A, a.workspace.id)).toBe(beforeA);

    const d = { directWorkspaceId: `dp-${RUN}-3`, contractNumber: `CT-${RUN}-C3`, contractor: "Delta", value: 7_000 };
    const b = await c.contractWorkspace.createFromDirectProcurement(d);
    expect(b.workspace.id).not.toBe(a.workspace.id); // origem faz parte da chave natural
    const beforeB = await contractSnapshot(ORG_A, b.workspace.id);
    const b2 = await c.contractWorkspace.createFromDirectProcurement(d);
    expect(b2.workspace.id).toBe(b.workspace.id);
    expect(await contractSnapshot(ORG_A, b.workspace.id)).toBe(beforeB);
    expect(await count(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ?`, [b.workspace.id, ORG_A])).toBe(1);
  }, 30_000);

  it("C4 — payload diferente (um campo) ou outro ator ⇒ CONFLICT, ZERO mutação; contrato avulso preserva o contrato existente", async () => {
    const c = await caller(lawyerA, ORG_A);
    const p = { processId: `proc-${RUN}-4`, contractNumber: `CT-${RUN}-C4`, contractor: "Épsilon", value: 1_000, term: "3 meses" };
    const { workspace } = await c.contractWorkspace.createFromProcurement(p);
    const before = await contractSnapshot(ORG_A, workspace.id);
    for (const variant of [
      { ...p, processId: `proc-${RUN}-4b` }, { ...p, contractor: "Outro" }, { ...p, value: 1_001 }, { ...p, term: "4 meses" },
    ]) {
      const e = await errOf(() => c.contractWorkspace.createFromProcurement(variant));
      expect(e.code).toBe("CONFLICT");
      expect(e.message).toContain("CONTRACT_ALREADY_EXISTS");
    }
    const c2 = await caller(lawyerA2, ORG_A);
    const eActor = await errOf(() => c2.contractWorkspace.createFromProcurement(p));
    expect(eActor.code).toBe("CONFLICT");
    expect(await contractSnapshot(ORG_A, workspace.id)).toBe(before);

    // Avulso (createManual) — convenção pré-existente mantida: CONFLICT com "(id: …)" para "abrir o existente".
    const m = { contractNumber: `CT-${RUN}-C4M`, contractor: "Zeta", object: "Objeto avulso", value: 10 };
    const created = await c.contractWorkspace.createManual({ idempotencyKey: `k1-${RUN}`, ...m });
    const beforeM = await contractSnapshot(ORG_A, created.workspace.id);
    const eM = await errOf(() => c2.contractWorkspace.createManual({ idempotencyKey: `k2-${RUN}`, ...m, contractor: "Intruso" }));
    expect(eM.code).toBe("CONFLICT");
    expect(eM.message).toContain(`(id: ${created.workspace.id})`);
    expect(eM.message).toContain("CONTRACT_ALREADY_EXISTS");
    expect(await contractSnapshot(ORG_A, created.workspace.id)).toBe(beforeM);
  }, 30_000);

  it("C5 — dupla criação concorrente (Promise.all): UMA linha, UM evento de criação", async () => {
    const c = await caller(lawyerA, ORG_A);
    const p = { processId: `proc-${RUN}-5`, contractNumber: `CT-${RUN}-C5`, contractor: "Eta", value: 50 };
    const [r1, r2] = await Promise.all([c.contractWorkspace.createFromProcurement(p), c.contractWorkspace.createFromProcurement(p)]);
    expect(r1.workspace.id).toBe(r2.workspace.id);
    expect(await count(`SELECT COUNT(*) n FROM contract_workspaces WHERE id = ? AND organization_id = ?`, [r1.workspace.id, ORG_A])).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ?`, [r1.workspace.id, ORG_A])).toBe(1);

    // Payloads diferentes em corrida: um vence, o outro CONFLICT; o vencedor não é sobrescrito.
    const q2 = { processId: `proc-${RUN}-5b`, contractNumber: `CT-${RUN}-C5B`, value: 1 };
    const settled = await Promise.allSettled([
      c.contractWorkspace.createFromProcurement({ ...q2, contractor: "X" }),
      c.contractWorkspace.createFromProcurement({ ...q2, contractor: "Y" }),
    ]);
    const ok = settled.filter(s => s.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const ko = settled.filter(s => s.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(String(ko[0].reason?.code)).toBe("CONFLICT");
    expect((await contractRow(ORG_A, ok[0].value.workspace.id)).contractor).toBe(ok[0].value.workspace.contractor);
    expect(await count(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND organization_id = ?`, [ok[0].value.workspace.id, ORG_A])).toBe(1);
  }, 30_000);

  it("C6 — isolamento: mesmo (origem, número) em outro tenant é independente e não toca o contrato do órgão A", async () => {
    const number = `CT-${RUN}-C6`;
    const cA = await caller(lawyerA, ORG_A);
    const a = await cA.contractWorkspace.createFromProcurement({ processId: `proc-${RUN}-6`, contractNumber: number, contractor: "Teta", value: 10 });
    await conn.execute(`UPDATE contract_workspaces SET status = 'vigente' WHERE id = ? AND organization_id = ?`, [a.workspace.id, ORG_A]);
    const beforeA = await contractSnapshot(ORG_A, a.workspace.id);
    const cB = await caller(lawyerB, ORG_B);
    const b = await cB.contractWorkspace.createFromProcurement({ processId: `proc-${RUN}-6`, contractNumber: number, contractor: "Outro órgão", value: 99 });
    expect(b.workspace.organizationId).toBe(ORG_B);
    expect(b.workspace.id).not.toBe(a.workspace.id);
    expect(await contractSnapshot(ORG_A, a.workspace.id)).toBe(beforeA);
    expect((await contractRow(ORG_B, b.workspace.id)).contractor).toBe("Outro órgão");
  }, 30_000);

  it("C7 — RBAC/tenant inalterados: não-membro do órgão é recusado (FORBIDDEN) sem escrita", async () => {
    const number = `CT-${RUN}-C7`;
    const cOut = await caller(outsider, ORG_A);
    const e = await errOf(() => cOut.contractWorkspace.createFromProcurement({ processId: `proc-${RUN}-7`, contractNumber: number }));
    expect(e.code).toBe("FORBIDDEN");
    expect(await count(`SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ? AND contract_number = ?`, [ORG_A, number])).toBe(0);
  }, 30_000);
});
