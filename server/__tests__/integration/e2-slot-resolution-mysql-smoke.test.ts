/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * E2 — resolução HUMANA dos trechos pendentes do Edital (slots de IA sem narrativa) — MySQL REAL, dados SINTÉTICOS, rotas tRPC da UI.
 * Só roda com DATABASE_URL. Nenhum órgão real; as pessoas são ids sintéticos (autor ≠ quem resolve ≠ emissor).
 *
 *  S1  fluxo: compor M1 sem narrativas → trechos pendentes visíveis → redigir (HUMAN_TEXT) e declarar ausência (DECLARED_NONE, só elegível)
 *      pela rota `institutionalTemplates.reviews.resolveSlot` → edição governada + decisão na MESMA transação → revalidação PASSED →
 *      rascunho continua editável/exportável → emissão ⇒ M2 com `slotResolutions` versionado (quem resolveu cada trecho)
 *  S2  adversarial: remover [REVISAR] sem resolução ⇒ emissão bloqueada; texto alterado após a resolução ⇒ STALE e nova resolução;
 *      DECLARED_NONE em trecho que exige redação; outro órgão; papel insuficiente; autoridade de outra conta; agente (ator não humano);
 *      idempotência (mesma chave converge; mesma chave com outro texto falha); CAS (hash e revisão) e concorrência; M1 trocado
 *  S3  LICIGOV-FAST (regressão 2167/2026): o MESMO gestor compõe, resolve os trechos e emite a versão preparatória (emitir ≠ aprovar);
 *      operator continua sem emitir; outro órgão não emite; texto visto desatualizado ⇒ CONFLICT; versão anterior imutável
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { useGlobalFixtureLock } from "../helpers/globalFixtureLock";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  getMembership: vi.fn(async (userId: number, organizationId: number) => ({ id: 1, organizationId, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { draftContentHash } from "../../domain/generatedDocument";
import { pendingSlotMark, slotPolicy } from "../../domain/institutionalTemplates/slotResolution";
import { generateTemplatedDocument } from "../../services/institutionalTemplates/templateCompositionService";
import { TemplateSlotResolutionService } from "../../services/institutionalTemplates/slotResolutionService";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateCompositionPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { buildInstitutionalModel, renderInstitutionalDOCX } from "../../services/documentConverter";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import { BLL, U_AUTHOR, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedGoverned, seedOfficialTr, seedWorld, type World } from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
// Faixa PRÓPRIA deste arquivo ([997.000.000, 998.000.000)).
const BASE_ORG = 997_000_000 + (STAMP % 9_000) * 100;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-e2s`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const err = async (p: Promise<unknown>): Promise<{ code?: string; message: string } | null> => p.then(() => null, (e) => e);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId, name: `Servidor sintético ${userId}` }), correlationId: `corr-e2s-${org}-${userId}`, requestId: `req-e2s-${org}` } as any;
};
const proc = (org: number, role = "operator", userId = U_EDITOR) => procurementProcessRouter.createCaller(ctx(org, role, userId));
const tpl = (org: number, role = "operator", userId = U_EDITOR) => institutionalTemplatesRouter.createCaller(ctx(org, role, userId));

const CONTRATADO = "obrigacoes-especificas-contratado";
const CONTRATANTE = "obrigacoes-especificas-contratante";
const SUBCONTRATACAO = "justificativa-vedacao-subcontratacao";

async function publishBll(org: number): Promise<void> {
  const wports = getTemplateWorkflowPorts();
  const reg = await new ModelRegistrationService(wports).register(ctxOf(org), {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: BLL.slug }, templateKey: BLL.modelKey, displayName: BLL.displayName,
    declaredScope: BLL.declaredScope, source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey },
    sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256,
    confirm: true, idempotencyKey: key("reg"), decision: decision(),
  });
  await new TemplateGovernanceService(wports).recordLegalEvidence(ctxOf(org), {
    revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decision({ basisReference: "Parecer jurídico — [preencher no piloto]" }),
    evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 },
  });
  const wf = new InstitutionalTemplatesWorkflow(wports);
  await wf.approve(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision({ basisReference: "Ato de aprovação" }) });
  await wf.publish(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decision({ basisReference: "Ato de publicação" }) });
  await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
}

/** Órgão sintético com modelo publicado e Edital composto SEM narrativas (todos os slots ficam pendentes). */
async function composed(label: string, author: number = U_AUTHOR): Promise<{ w: World; m1: string }> {
  const org = newOrg();
  const w = await seedWorld(conn, org, label, { flagOn: true });
  await seedGoverned(w, undefined, "publico", label);
  const tr = await seedOfficialTr(conn, w);
  await publishBll(org);
  const g = await generateTemplatedDocument({
    organizationId: org, subjectId: w.processId, documentKind: "edital", documentType: "edital", scope: { ...BLL.declaredScope },
    asOf: "2026-10-07T00:00:00Z", title: "Edital de Pregão Eletrônico — sintético", actorUserId: author, correlationId: `corr-gen-${org}`,
    aiNarratives: [], officialPins: { TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } },
  }, getTemplateCompositionPorts());
  return { w, m1: g.generationManifest.id };
}

const draftOf = async (w: World): Promise<{ content: string; contentHash: string }> => ((await proc(w.org).reviewableDraft({ processId: w.processId, kind: "edital" })) as any).draft;
const review = async (w: World): Promise<any> => proc(w.org).editalTemplateReviewState({ processId: w.processId });
const slotOf = async (w: World, slotKey: string): Promise<any> => (await review(w)).slots.find((s: any) => s.slotKey === slotKey);
const resolveInput = async (w: World, m1: string, slotKey: string, resolution: "HUMAN_TEXT" | "DECLARED_NONE", text?: string, over: Record<string, unknown> = {}) => {
  const d = await draftOf(w);
  const s = await slotOf(w, slotKey);
  return {
    processId: w.processId, manifestId: m1, slotKey, resolution, ...(text !== undefined ? { text } : {}), expectedContentHash: d.contentHash,
    expectedRevision: s?.revision ?? 0, confirm: true, idempotencyKey: key(`rs-${slotKey}`), ...over,
  };
};
/** O input é montado ANTES de criar o caller (a leitura usada para montá-lo reconfigura o papel simulado do contexto). */
const resolveSlot = async (w: World, m1: string, slotKey: string, resolution: "HUMAN_TEXT" | "DECLARED_NONE", text?: string, userId = U_EDITOR): Promise<any> => {
  const inp = await resolveInput(w, m1, slotKey, resolution, text);
  return tpl(w.org, "operator", userId).reviews.resolveSlot(inp);
};
const textFor = (k: string) => `Redação sintética do trecho ${k}, elaborada pela equipe de licitações do órgão.`;
const promote = async (w: World): Promise<any> => {
  const d = await draftOf(w);
  return proc(w.org, "manager", U_MANAGER).promoteOfficial({ processId: w.processId, kind: "edital", idempotencyKey: key("promo"), expectedContentHash: d.contentHash, reason: "Emissão do Edital revisado." } as any);
};
const writes = async (w: World) => ({
  decisions: await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_slot_resolution'", [w.org]),
  edits: await count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ?", [w.org]),
  hash: (await draftOf(w)).contentHash,
});

useGlobalFixtureLock("legal_reference");

describe.skipIf(!DB)("E2 — resolução humana dos trechos pendentes do Edital (MySQL real, rotas da UI)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "e2-slot-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  it("S1 — trechos visíveis, redação e declaração por pessoa, rascunho editável/exportável, emissão com M2 versionado", async () => {
    const { w, m1 } = await composed("s1");
    // [1] trechos pendentes visíveis, com elegibilidade correta
    const rs0 = await review(w);
    const keys = rs0.slots.map((s: any) => s.slotKey);
    expect(keys).toEqual(expect.arrayContaining([CONTRATADO, CONTRATANTE, SUBCONTRATACAO]));
    expect(rs0.slots.every((s: any) => s.state === "PENDING" && s.revision === 0)).toBe(true);
    expect(rs0.slots.find((s: any) => s.slotKey === CONTRATANTE)).toMatchObject({ declaredNoneAllowed: true, inline: false });
    expect(rs0.slots.find((s: any) => s.slotKey === SUBCONTRATACAO)).toMatchObject({ declaredNoneAllowed: false, inline: true });
    // a rota devolve o ENTORNO do trecho (onde e como o texto entra) — a pessoa não precisa procurar o marcador no rascunho
    expect(rs0.slots.find((s: any) => s.slotKey === SUBCONTRATACAO).context.before).toMatch(/pelas razões constantes do processo: $/);
    expect(rs0.slots.every((s: any) => s.context && typeof s.context.after === "string")).toBe(true);
    expect((await err(promote(w)))?.message).toMatch(/EMISSION_REVIEW_MARKERS|UNRESOLVED_MARKERS/);

    // [2][3] redação e declaração pela rota (pessoa autenticada; autor da composição ≠ quem resolve)
    const r1 = await resolveSlot(w, m1, CONTRATADO, "HUMAN_TEXT", `  ${textFor(CONTRATADO)}\r\n`);
    expect(r1).toMatchObject({ revision: 1, replayed: false, documentChanged: true });
    expect((await draftOf(w)).content).toContain(`\n\n${textFor(CONTRATADO)}\n\n`);   // normalizado, no lugar do marcador
    for (const s of (await review(w)).slots) if (s.state !== "RESOLVED") await resolveSlot(w, m1, s.slotKey, s.slotKey === CONTRATANTE ? "DECLARED_NONE" : "HUMAN_TEXT", s.slotKey === CONTRATANTE ? undefined : textFor(s.slotKey));
    const rs1 = await review(w);
    expect(rs1.slots.every((s: any) => s.state === "RESOLVED")).toBe(true);
    expect(rs1.slots.find((s: any) => s.slotKey === CONTRATANTE)).toMatchObject({ resolution: "DECLARED_NONE", resolvedByName: "Servidor sintético 202" });
    expect((await draftOf(w)).content).toContain(slotPolicy(CONTRATANTE).declaredNoneText!);
    expect(rs1.unresolvedMarkers.count).toBe(0);
    expect(rs1.structuralDeviations).toEqual([]);                          // preencher o trecho não é desvio estrutural
    expect(rs1.revalidation).toEqual({ status: "PASSED", issues: [] });

    // ledger: uma decisão e uma edição governada por trecho, atribuídas à pessoa que resolveu; evidência sem conteúdo pessoal
    const dec = await rows("SELECT outcome, recorded_by_user_id u, decided_by_user_id d, evidence FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_slot_resolution'", [w.org]);
    expect(dec).toHaveLength(keys.length);
    expect(dec.every((x: any) => x.u === U_EDITOR && (x.d === null || x.d === U_EDITOR))).toBe(true);
    const edits = await rows("SELECT operation, actor_user_id a, reason FROM generated_document_edits WHERE organization_id = ? ORDER BY id", [w.org]);
    const slotEdits = edits.filter((e: any) => String(e.reason ?? "").includes("template_slot_resolution"));
    expect(slotEdits).toHaveLength(keys.length);
    expect(slotEdits.every((e: any) => e.operation === "human_edit" && e.a === U_EDITOR)).toBe(true);

    // [8] rascunho continua editável (edição FORA dos trechos não desatualiza) e exportável
    const d1 = await draftOf(w);
    await proc(w.org).saveReviewableDraft({ processId: w.processId, kind: "edital", content: `${d1.content}\nObservação da equipe: revisão final do rascunho.\n`, expectedContentHash: d1.contentHash, idempotencyKey: key("edit") });
    expect((await review(w)).slots.every((s: any) => s.state === "RESOLVED")).toBe(true);
    const model = buildInstitutionalModel((await draftOf(w)).content, { documentTitle: "Edital — rascunho", statusLabel: "RASCUNHO", isDraft: true, version: 1, exportedAtLabel: "09/11/2026" });
    expect((await renderInstitutionalDOCX(model)).length).toBeGreaterThan(1000);

    // [5][8] emissão (gestor ≠ autor ≠ quem resolveu) ⇒ M2 com as resoluções no formato versionado
    const res = await promote(w);
    expect(res.promoted).toBe(true);
    const m2 = (await rows("SELECT body_json b, derived_from_manifest_id d FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [w.org]))[0];
    expect(m2.d).toBe(m1);
    const body = JSON.parse(m2.b);
    expect(body.slotResolutions.formatVersion).toBe("tpl-slot-resolution/1");
    expect(body.slotResolutions.items.map((i: any) => i.slotKey)).toEqual([...keys].sort());
    expect(body.slotResolutions.items.every((i: any) => i.resolvedByUserId === U_EDITOR && /^idc_/.test(i.decisionRef))).toBe(true);
    const official = (await rows("SELECT content FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [w.org]))[0];
    expect(official.content).not.toMatch(/\[REVISAR/);
  }, 600_000);

  it("S2 — remoção sem resolução, alteração posterior, política, tenant, papel, autoria, agente, idempotência, CAS e concorrência", async () => {
    const { w, m1 } = await composed("s2");
    const b = await composed("s2b");

    // [9] apagar o marcador pelo editor NÃO resolve: o trecho segue pendente e a emissão bloqueia
    const d0 = await draftOf(w);
    const erased = d0.content.split(pendingSlotMark(CONTRATADO)).join("Texto colocado no lugar do marcador.");
    await proc(w.org).saveReviewableDraft({ processId: w.processId, kind: "edital", content: erased, expectedContentHash: d0.contentHash, idempotencyKey: key("erase") });
    const st = await slotOf(w, CONTRATADO);
    expect(st.state).toBe("PENDING");
    expect(st.reason).toMatch(/removido do texto sem resolução/);
    const lost = await err(resolveSlot(w, m1, CONTRATADO, "HUMAN_TEXT", textFor(CONTRATADO)));
    expect(lost?.code).toBe("BAD_REQUEST");                              // sem marcador nem resolução anterior: orienta a reinserir o marcador
    expect(lost?.message).toContain(pendingSlotMark(CONTRATADO));
    for (const s of (await review(w)).slots.filter((x: any) => x.slotKey !== CONTRATADO)) {
      await resolveSlot(w, m1, s.slotKey, "HUMAN_TEXT", textFor(s.slotKey));
    }
    expect((await err(promote(w)))?.message).toMatch(/AI_SLOT_UNRESOLVED/);
    // reinsere o marcador no editor e resolve normalmente
    const d1 = await draftOf(w);
    await proc(w.org).saveReviewableDraft({ processId: w.processId, kind: "edital", content: d1.content.replace("Texto colocado no lugar do marcador.", pendingSlotMark(CONTRATADO)), expectedContentHash: d1.contentHash, idempotencyKey: key("reinsert") });
    await resolveSlot(w, m1, CONTRATADO, "HUMAN_TEXT", textFor(CONTRATADO));
    expect((await review(w)).revalidation.status).toBe("PASSED");

    // [10] texto alterado depois da resolução ⇒ STALE e emissão bloqueada; nova resolução da redação atual (sem mudar o texto) volta a valer
    const d2 = await draftOf(w);
    const changedText = textFor(SUBCONTRATACAO).replace("equipe", "comissão");
    await proc(w.org).saveReviewableDraft({ processId: w.processId, kind: "edital", content: d2.content.replace(textFor(SUBCONTRATACAO), changedText), expectedContentHash: d2.contentHash, idempotencyKey: key("change") });
    const stale = await slotOf(w, SUBCONTRATACAO);
    // F1: no trecho EM LINHA o ponto final da frase é do modelo (fica fora do trecho) — o texto atual vem sem ele
    expect(stale).toMatchObject({ state: "STALE", currentText: changedText.replace(/\.$/, ""), revision: 1 });
    expect((await err(promote(w)))?.message).toMatch(/AI_SLOT_RESOLUTION_STALE/);
    const before = await writes(w);
    const again = await resolveSlot(w, m1, SUBCONTRATACAO, "HUMAN_TEXT", stale.currentText);
    expect(again).toMatchObject({ revision: 2, documentChanged: false });
    expect(await writes(w)).toEqual({ ...before, decisions: before.decisions + 1 });   // só a decisão; o texto não muda
    expect((await slotOf(w, SUBCONTRATACAO)).state).toBe("RESOLVED");

    // [14] DECLARED_NONE não dispensa conteúdo obrigatório (justificativa) — nada gravado
    const w0 = await writes(w);
    const declaredIn = await resolveInput(w, m1, SUBCONTRATACAO, "DECLARED_NONE");
    const declared = await err(tpl(w.org).reviews.resolveSlot(declaredIn));
    expect(declared?.code).toBe("BAD_REQUEST");
    expect(await writes(w)).toEqual(w0);

    // [12] outro órgão: processo/M1 alheios ⇒ NOT_FOUND, nada gravado em nenhum dos dois
    const wb0 = await writes(b.w);
    const crossInput = await resolveInput(w, m1, CONTRATANTE, "DECLARED_NONE");
    expect((await err(tpl(b.w.org).reviews.resolveSlot(crossInput)))?.code).toBe("NOT_FOUND");
    expect((await err(tpl(b.w.org).reviews.resolveSlot({ ...crossInput, processId: b.w.processId, expectedContentHash: wb0.hash })))?.code).toBe("CONFLICT");   // M1 de outro órgão ≠ M1 vigente
    expect(await writes(w)).toEqual(w0);
    expect(await writes(b.w)).toEqual(wb0);
    expect((await err(proc(b.w.org).editalTemplateReviewState({ processId: w.processId })))?.code).toBe("NOT_FOUND");

    // [13] papel insuficiente (viewer) ⇒ FORBIDDEN, nada gravado
    // (o input é montado ANTES: montar o input usa a rota de leitura e reconfiguraria o papel simulado do contexto)
    const viewerIn = await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE");
    expect((await err(tpl(b.w.org, "viewer").reviews.resolveSlot(viewerIn)))?.code).toBe("FORBIDDEN");
    expect(await writes(b.w)).toEqual(wb0);

    // [17] decisão atribuída à conta de OUTRA pessoa ⇒ recusada antes de qualquer escrita (inclusive da edição)
    const forgedIn = await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE");
    const forged = await err(tpl(b.w.org).reviews.resolveSlot({
      ...forgedIn,
      decision: { decidedByName: "Outra Pessoa", decidedByRole: "Prefeito", decidedByUserId: U_MANAGER, decidedAt: "2026-11-09", basisReference: "Portaria 1/2026", reason: "Registro em nome de terceiro." },
    }));
    expect(forged?.message).toMatch(/DECISION_AUTHORITY_NOT_ACTOR|própria? nome|seu próprio nome/);
    expect(await writes(b.w)).toEqual(wb0);

    // [18] agente/automação (ator não humano) não registra resolução
    const agent = await err(new TemplateSlotResolutionService(getTemplateCompositionPorts()).resolveSlot(ctxOf(b.w.org, U_EDITOR, "ai"), {
      ...(await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE")), decision: decision(),
    } as any));
    expect(agent?.message).toMatch(/pessoa autenticada/);
    expect(await writes(b.w)).toEqual(wb0);

    // [15] idempotência: mesma chave + mesmo pedido ⇒ mesma decisão (sem nova escrita); mesma chave + outro texto ⇒ recusa
    const inp = await resolveInput(b.w, b.m1, CONTRATADO, "HUMAN_TEXT", textFor(CONTRATADO));
    const first: any = await tpl(b.w.org).reviews.resolveSlot(inp);
    const after1 = await writes(b.w);
    const replay: any = await tpl(b.w.org).reviews.resolveSlot(inp);
    expect(replay).toMatchObject({ decisionId: first.decisionId, replayed: true });
    expect(await writes(b.w)).toEqual(after1);
    const reused = await err(tpl(b.w.org).reviews.resolveSlot({ ...inp, text: "Outro texto com a mesma chave de idempotência." }));
    expect(reused?.code).toBe("BAD_REQUEST");
    expect(await writes(b.w)).toEqual(after1);

    // [16] CAS: hash do rascunho visto obsoleto ⇒ CONFLICT; revisão da resolução obsoleta ⇒ CONFLICT; nada gravado
    const hashIn = await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE");
    const stalehash = await err(tpl(b.w.org).reviews.resolveSlot({ ...hashIn, expectedContentHash: draftContentHash("antigo") }));
    expect(stalehash?.code).toBe("CONFLICT");
    const revIn = await resolveInput(b.w, b.m1, CONTRATADO, "HUMAN_TEXT", `${textFor(CONTRATADO)} Nova versão.`);
    const staleRev = await err(tpl(b.w.org).reviews.resolveSlot({ ...revIn, expectedRevision: 0 }));
    expect(staleRev?.code).toBe("CONFLICT");
    expect(await writes(b.w)).toEqual(after1);
    // M1 que não é o vigente do rascunho ⇒ CONFLICT (recarregar)
    const otherM1In = await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE");
    expect((await err(tpl(b.w.org).reviews.resolveSlot({ ...otherM1In, manifestId: m1 })))?.code).toBe("CONFLICT");

    // concorrência: duas pessoas resolvem o MESMO trecho a partir do mesmo estado ⇒ exatamente uma vence
    const base = await resolveInput(b.w, b.m1, CONTRATANTE, "DECLARED_NONE");
    const race = await Promise.allSettled([
      tpl(b.w.org, "operator", U_EDITOR).reviews.resolveSlot({ ...base, idempotencyKey: key("race-a") }),
      tpl(b.w.org, "operator", U_EDITOR + 1).reviews.resolveSlot({ ...base, resolution: "HUMAN_TEXT", text: textFor(CONTRATANTE), idempotencyKey: key("race-b") }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_slot_resolution' AND subject_id LIKE ?", [b.w.org, `${b.m1}:%`])).toBe(after1.decisions + 1);
  }, 600_000);

  it("S3 — LICIGOV-FAST (regressão 2167/2026): um único gestor compõe, resolve os trechos e emite; operator/outro órgão/texto desatualizado continuam barrados", async () => {
    const { w, m1 } = await composed("s3", U_MANAGER);   // autor = gestor
    const b = await composed("s3b");
    const mgr = (o: number) => tpl(o, "manager", U_MANAGER);
    // o mesmo gestor resolve os trechos (vira o último ator substantivo) — antes: emissão recusada por "segregação de deveres"
    for (const s of (await review(w)).slots) {
      const inp = await resolveInput(w, m1, s.slotKey, s.declaredNoneAllowed ? "DECLARED_NONE" : "HUMAN_TEXT", s.declaredNoneAllowed ? undefined : textFor(s.slotKey));
      await mgr(w.org).reviews.resolveSlot(inp);
    }
    const draftRow = (await rows("SELECT author_user_id a, last_substantive_actor_user_id l FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [w.org, w.processId]))[0];
    expect(draftRow).toMatchObject({ a: U_MANAGER, l: U_MANAGER });
    const d1 = await draftOf(w);
    const promoteAs = (org: number, role: string, user: number, hash: string, k: string) =>
      proc(org, role, user).promoteOfficial({ processId: w.processId, kind: "edital", idempotencyKey: key(k), expectedContentHash: hash, reason: "Versão preparatória do Edital." } as any);
    // operator (mesmo órgão) continua sem competência para emitir
    expect((await err(promoteAs(w.org, "operator", U_EDITOR, d1.contentHash, "op")))?.code).toBe("FORBIDDEN");
    // outro órgão não enxerga o processo
    expect((await err(promoteAs(b.w.org, "manager", U_MANAGER, d1.contentHash, "x")))?.code).toBe("NOT_FOUND");
    // texto visto desatualizado ⇒ CONFLICT (nenhuma emissão de versão velha)
    expect((await err(promoteAs(w.org, "manager", U_MANAGER, draftContentHash("versão antiga"), "old")))?.code).toBe("CONFLICT");
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [w.org])).toBe(0);
    // o mesmo gestor (autor + último editor) conclui a versão preparatória
    const v1: any = await promoteAs(w.org, "manager", U_MANAGER, d1.contentHash, "v1");
    expect(v1.promoted).toBe(true);
    const off1 = (await rows("SELECT id, content, metadata FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [w.org]))[0];
    const meta = typeof off1.metadata === "string" ? JSON.parse(off1.metadata) : off1.metadata;
    expect(meta).toMatchObject({ authorUserId: U_MANAGER, lastSubstantiveActorUserId: U_MANAGER, emitterUserId: U_MANAGER });
    const m2 = JSON.parse((await rows("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [w.org]))[0].b);
    expect(m2.slotResolutions.items.every((i: any) => i.resolvedByUserId === U_MANAGER)).toBe(true);   // E2 íntegra (resoluções legítimas)
    // nova edição + nova emissão ⇒ v2; a v1 permanece imutável
    await proc(w.org, "manager", U_MANAGER).saveReviewableDraft({ processId: w.processId, kind: "edital", content: `${d1.content}\nNota final da equipe.\n`, expectedContentHash: d1.contentHash, idempotencyKey: key("ed2") });
    const v2: any = await promoteAs(w.org, "manager", U_MANAGER, (await draftOf(w)).contentHash, "v2");
    expect(v2.promoted).toBe(true);
    const after1 = (await rows("SELECT content FROM official_documents WHERE tenant_id = ? AND id = ?", [w.org, off1.id]))[0];
    expect(after1.content).toBe(off1.content);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [w.org])).toBe(2);
  }, 600_000);
});
