/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LICIGOV-FAST PR-2 — Dados orçamentários do processo (dotação/fonte) e pendência INFORMATIVA — MySQL REAL, dados SINTÉTICOS, pelas
 * MESMAS rotas e planos da tela (órgãos sintéticos numa faixa própria; nunca a organização 1; nenhum modelo de produção).
 *
 *  F1  sem dotação/fonte: preparação mostra pendência INFORMATIVA (fora das decisões e das pendências na origem); preflight pronto;
 *      Edital gerado com o marcador governado (sem [REVISAR]); M1 no formato anterior (sem campo novo); emissão oficial permitida (autoridade/SoD intactas)
 *  F2  registro ÚNICO no processo → Edital e TR reaproveitam (declarado); M1 sem pendência; nada é perguntado de novo no Edital
 *  F3  governança: substituição exige confirmação explícita (CONFLICT sem ela, valor preservado); histórico; replay idempotente; CAS;
 *      escrita genérica e CertameConfig recusam (escritor único)
 *  F4  RBAC e isolamento: operador recusado; outro órgão não lê nem grava
 *  F5  documento emitido é imutável: registrar a dotação depois não altera o oficial
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { useGlobalFixtureLock } from "../helpers/globalFixtureLock";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  // SECURITY-02 — a autoridade institucional é lida da fonte autoritativa (getMembership): o ator do router destes cenários
  // é MEMBRO REAL do órgão com o papel do contexto (a releitura transacional da emissão continua no MySQL real).
  getMembership: vi.fn(async (userId: number, organizationId: number) => ({ id: 1, organizationId, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
const legacy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../services/procurementProcessService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/procurementProcessService")>();
  return { ...actual, generateNotice: vi.fn(async () => { legacy.calls++; throw new Error("gerador legado não deve ser chamado no fluxo BOUND"); }) };
});

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { draftContentHash } from "../../domain/generatedDocument";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import { buildEditalReadiness, generationCta } from "../../../client/src/lib/editalReadiness";
import { completeProfile, fillTrParams, profileAsPrepView, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, U_EDITOR, U_MANAGER, publishBllModel, cleanupOrgs, ctxOf, decision, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
// Faixa PRÓPRIA deste arquivo ([996.000.000, 996.900.000)): nunca compartilha ids de órgão com outros arquivos; órgãos SINTÉTICOS.
const BASE_ORG = 996_000_000 + (STAMP % 9_000) * 100;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-fp2`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-fp2-${org}-${userId}`, requestId: `req-fp2-${org}` } as any;
};
const proc = (org: number, role = "manager", userId = 101) => procurementProcessRouter.createCaller(ctx(org, role, userId));
const tpl = (org: number, role = "manager", userId = U_MANAGER) => institutionalTemplatesRouter.createCaller(ctx(org, role, userId));
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;
const pin = (tr: { documentId: string; version: number; contentHash: string }) => ({ TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } });

async function publishBll(org: number): Promise<{ identityId: string; revisionId: string }> {
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
  return { identityId: reg.identity.id, revisionId: reg.revision.id };
}

interface P { org: number; w: World; tr: { documentId: string; version: number; contentHash: string }; model: { identityId: string; revisionId: string } | null }
const TR_META = { object: "Aquisição sintética de material de expediente (objeto estruturado do TR)" };

/** Órgão + modelo publicado/vinculado + processo + TR oficial emitido (com objeto estruturado). SEM campos governados. */
async function prepareOrg(label: string): Promise<P> {
  const org = newOrg();
  const w = await seedWorld(conn, org, label, { flagOn: true });
  const tr = await seedOfficialTr(conn, w, 1, "TERMO DE REFERÊNCIA — conteúdo sintético v1", TR_META);
  return { org, w, tr, model: await publishBll(org) };
}

/** Estado de preparação; por padrão com o TR EXATO selecionado (como a tela faz); `pinned=false` ⇒ ainda sem seleção do TR. */
const getState = async (p: P, pinned = true): Promise<PreparationStateView> =>
  (await proc(p.org).editalTemplatePreparation({ processId: p.w.processId, ...WS, ...(pinned ? { officialPins: pin(p.tr) } : {}) })) as any;
const preflight = (p: P): Promise<any> => proc(p.org).editalTemplatePreflight({ processId: p.w.processId, ...WS, officialPins: pin(p.tr) });
/** O que a UI faz ao "Confirmar e registrar": escritas sequenciais pelas rotas governadas existentes. */
function writerFor(p: P, state: PreparationStateView, keys?: Map<string, string>, afterWrite?: (w: PlannedWrite) => Promise<void>) {
  return {
    async write(w: PlannedWrite, expectedRevision: number) {
      const idempotencyKey = keys ? (keys.get(w.id) ?? (keys.set(w.id, key(w.id)), keys.get(w.id)!)) : key(w.id);
      const base = { confirm: true as const, idempotencyKey, decision: decision(), expectedRevision };
      let r: any;
      if (w.kind === "ORG") r = await tpl(p.org).governed.recordOrganizationFields({ ...base, catalogVersion: state.catalogVersion, source: w.source as any, fields: w.fields ?? {} });
      else r = await tpl(p.org).governed.recordProcessFields({ ...base, catalogVersion: state.catalogVersion, processId: p.w.processId, source: w.source as any, fields: w.fields ?? {} });
      if (afterWrite) await afterWrite(w);
      return { revision: r.decision.revision as number };
    },
  };
}
const stale = (e: unknown) => isStaleSave((e as any)?.data?.code, e instanceof Error ? e.message : String(e));


const harnessOf = (p: P): ReuseHarness => ({ org: p.org, proc: () => proc(p.org), tpl: () => tpl(p.org), ws: WS, processId: p.w.processId, key });
const TR_SKIP = ["processo.objetoCompleto"];
/** Confirma os parâmetros do TR e "emite" o TR com ESTE snapshot (a promoção real grava o digest do marcador `trparams:`). */
async function fillTrStamped(p: P): Promise<{ typed: string[] }> {
  const r = await fillTrParams(harnessOf(p), {}, TR_SKIP);
  await stampTrLineage(conn, harnessOf(p), p.tr.documentId);
  return r;
}
const gen = (p: P) => proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("gen") } as any) as Promise<any>;
const draftText = async (p: P) => (await rows("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]))[0]?.content as string | undefined;

/** Decisões genuínas do certame (preparação do Edital): digita SÓ o que a tela mostra como pendente, com o plano da tela. */
async function fillTrueDecisions(p: P): Promise<string[]> {
  const typed: string[] = [];
  // PR #288: divulgação do orçamento (Pesquisa de Preços) e regime de participação (Itens) têm ORIGEM própria; o Edital não os pede.
  { const st0 = await getState(p); if (!st0.budgetDisclosure) await setBudgetDisclosure(harnessOf(p)); if (st0.participationPending) await setItemsParticipation(harnessOf(p)); }
  for (let round = 1; round <= 8; round++) {
    const st = await getState(p);
    const pend = livePendingItems(st, {});
    if (pend.length === 0) return typed;
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of pend) { (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValueByName(field.name)); typed.push(field.name); }
    const plan = buildSavePlan(st, { edits: edits as any });
    expect(plan.errors).toEqual({});
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st), stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
  }
  throw new Error("decisões não convergiram");
}

/** Percorre a revisão humana até a emissão (M2) — o mesmo caminho do operador. */
async function reviewAndIssue(p: P): Promise<{ m1: string; officialId: string }> {
  const ra = await gen(p);
  expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
  const draft = (await rows("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]))[0];
  const human = draft.content.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe.");
  await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draft.content), idempotencyKey: key("edit") });
  const rs: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
  for (const d of rs.structuralDeviations) {
    await tpl(p.org, "operator", U_MANAGER).reviews.acknowledgeDeviation({ manifestId: rs.generationManifestId, blockId: d.blockId, kind: d.kind, confirm: true, idempotencyKey: key("ack"), decision: decision({ basisReference: "Revisão" }) });
  }
  const promoted: any = await proc(p.org, "manager", U_MANAGER).promoteOfficial({ processId: p.w.processId, kind: "edital", idempotencyKey: key("promo"), expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor." } as any);
  expect(promoted.promoted).toBe(true);
  const official = (await rows("SELECT id FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido' AND origin = ?", [p.org, p.w.processId]))[0];
  const m1 = (await rows("SELECT manifest_hash h FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [p.org, ra.generationManifestId]))[0].h;
  return { m1, officialId: official.id };
}


const fieldOf = (st: any, name: string) => [...st.sections.flatMap((s: any) => s.fields), ...st.canonicalFields].find((f: any) => f.name === name);
// Relógio CONTROLADO do fluxo governado (geração M1 e emissão M2 usam o `clock` das ports de composição).
let clockNow: string | null = null;
const realPorts = () => createTemplateCompositionPorts();

/** Tenant pronto para compor (tudo registrado nas origens). */
async function readyTenant(label: string): Promise<P> {
  const p = await prepareOrg(label);
  await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p)); await fillTrueDecisions(p);
  return p;
}

import { CONTENT_PENDING_VARIABLES } from "../../domain/institutionalTemplates/contentPending";
import { renderBudgetAllocationForTr } from "../../services/institutionalTemplates/trStructuredParamsService";
import { getTemplateCompositionPorts } from "../../services/institutionalTemplates/portsRegistry";
const bridgeDeps = () => ({ ports: getTemplateCompositionPorts(), now: () => new Date().toISOString() });

const DOT = "julgamento.dotacaoOrcamentaria";
const U_AUTHOR_R3 = 101;
const FON = "julgamento.fonteRecursos";
const DOT_TEXT = CONTENT_PENDING_VARIABLES[DOT]!.absentText;
const FON_TEXT = CONTENT_PENDING_VARIABLES[FON]!.absentText;
const DOT_VALUE = "02.001.04.122.0002.2.003 — 3.3.90.30 (sintética)";
const FON_VALUE = "Recursos ordinários livres — 1.500 (sintética)";
const budgetState = (p: P, org = p.org, role = "manager") => proc(org, role).budgetDisclosure({ processId: p.w.processId, ...WS }) as Promise<any>;
const recordAllocation = async (p: P, values: { dotacaoOrcamentaria?: string | null; fonteRecursos?: string | null }, opts: { confirmReplace?: boolean; idempotencyKey?: string; expectedRevision?: number; org?: number; role?: string } = {}) => {
  const st = await budgetState(p);
  return tpl(opts.org ?? p.org, opts.role ?? "manager").governed.recordBudgetAllocation({
    confirm: true, idempotencyKey: opts.idempotencyKey ?? key("alloc"), decision: decision(), expectedRevision: opts.expectedRevision ?? st.baseDateRevision,
    catalogVersion: st.allocation.catalogVersion, processId: p.w.processId, ...values, ...(opts.confirmReplace ? { confirmReplace: true } : {}),
  }) as Promise<any>;
};
const m1Of = async (p: P, manifestId: string) => JSON.parse((await rows("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [p.org, manifestId]))[0].b);
const err = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); } catch (e) { return e; } throw new Error("era esperado erro"); };

useGlobalFixtureLock("legal_reference");

describe.skipIf(!DB)("LICIGOV-FAST PR-2 — dotação/fonte do processo e pendência informativa (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts({ ...realPorts(), clock: { now: () => clockNow ?? new Date().toISOString() } });
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "fast-pr2-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (ORGS.length) await conn.query(`DELETE FROM procurement_context_facts WHERE organization_id IN (${ORGS.map(() => "?").join(",")})`, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  let emitted: { p: P; officialId: string; content: string } | null = null;

  it("F1 — sem dotação/fonte: pendência INFORMATIVA; preflight pronto; Edital gerado com o marcador (sem [REVISAR]); M1 sem campo novo; emissão permitida", async () => {
    const p = await readyTenant("fp2-sem-dotacao");
    const st: any = await getState(p);
    for (const n of [DOT, FON]) expect(fieldOf(st, n), n).toMatchObject({ status: "CONTENT_PENDING", entry: "PROCESS_BUDGET" });
    expect(st.upstream.contentPending.map((c: any) => c.name).sort()).toEqual([DOT, FON]);
    expect(st.upstream.sourcePending.map((c: any) => c.name)).not.toContain(DOT);
    // nada é perguntado no Edital: não é decisão do certame nem pendência na origem que bloqueia
    const readiness = buildEditalReadiness(st);
    expect(readiness.counters.PROCESS_DECISIONS_TOTAL).toBe(0);
    expect(readiness.originGroups.flatMap((g: any) => g.items.map((i: any) => i.key))).not.toContain(DOT);
    expect((await preflight(p)).status).toBe("READY_FOR_COMPOSITION");
    expect(generationCta(readiness, { ready: true }).generateDisabledReason).toBeUndefined();
    // estado orçamentário: Pendente (não "verificado")
    const bs = await budgetState(p);
    expect(bs.allocation).toMatchObject({ dotacao: { value: null, status: "PENDING" }, fonte: { value: null, status: "PENDING" }, srp: false });

    const ra = await gen(p);
    expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const draft = (await draftText(p))!;
    expect(draft).toContain(`dotação orçamentária: ${DOT_TEXT} — Fonte de recursos: ${FON_TEXT}.`);
    expect(draft).not.toMatch(/\[REVISAR: julgamento\.(dotacaoOrcamentaria|fonteRecursos)/);
    // gate R1: formato do M1 persistido inalterado (sem campo novo); a pendência fica no texto selado pelo hash
    expect((await m1Of(p, ra.generationManifestId)).contentPending).toBeUndefined();

    // emissão oficial pelo caminho governado (revisão de outro usuário + gestor; SoD intacta): a pendência NÃO bloqueia
    const { officialId } = await reviewAndIssue(p);
    // gate R1 — contrato com o leitor da staging 9226e4b: o body_json PERSISTIDO de M1 e M2 só tem chaves que ele reconstrói
    const BODY_KEYS_9226E4B = new Set(["sources", "conditionalDecisions", "aiNarratives", "annexes", "lateBound", "deferredPublication", "humanEditRefs", "canonicalRevalidation", "lifecycleBindings"]);
    const bodies = await rows("SELECT stage, body_json b FROM document_composition_manifests WHERE organization_id = ?", [p.org]);
    expect(new Set(bodies.map((x: any) => x.stage))).toEqual(new Set(["GENERATION", "ISSUANCE"]));
    for (const x of bodies) expect(Object.keys(JSON.parse(x.b)).filter((k) => !BODY_KEYS_9226E4B.has(k)), x.stage).toEqual([]);
    const official = (await rows("SELECT content FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, officialId]))[0];
    expect(official.content).toContain(DOT_TEXT);
    emitted = { p, officialId, content: official.content };
  }, 600_000);

  it("F2 — registro ÚNICO no processo: Edital (sem nova pergunta) e TR reaproveitam o DECLARADO; M1 sem pendência", async () => {
    const p = await readyTenant("fp2-com-dotacao");
    const r = await recordAllocation(p, { dotacaoOrcamentaria: DOT_VALUE, fonteRecursos: FON_VALUE });
    expect(r.decision.revision).toBeGreaterThan(0);
    const bs = await budgetState(p);
    expect(bs.allocation).toMatchObject({ dotacao: { value: DOT_VALUE, status: "DECLARED" }, fonte: { value: FON_VALUE, status: "DECLARED" } });

    const st: any = await getState(p);
    expect(fieldOf(st, DOT)).toMatchObject({ status: "AUTO", displayValue: DOT_VALUE, origin: { label: "Dados orçamentários do processo (declarado)" } });
    expect(st.upstream.contentPending).toEqual([]);
    expect(livePendingItems(st, {}).map((i: any) => i.field.name)).not.toContain(DOT);

    const ra = await gen(p);
    const draft = (await draftText(p))!;
    expect(draft).toContain(`dotação orçamentária: ${DOT_VALUE} — Fonte de recursos: ${FON_VALUE}.`);
    expect(draft).not.toContain(DOT_TEXT);
    expect((await m1Of(p, ra.generationManifestId)).contentPending).toBeUndefined();

    // TR: o MESMO registro vira o bloco determinístico (proposta editável do rascunho)
    const block = await renderBudgetAllocationForTr(bridgeDeps(), p.org, p.w.processId, WS as any);
    expect(block!.block).toContain(`- Dotação orçamentária: ${DOT_VALUE}`);
    expect(block!.block).toContain(`- Fonte de recursos: ${FON_VALUE}`);
    expect(block!.pending).toEqual([]);
  }, 600_000);

  it("F3 — governança: substituição explícita, histórico, replay idempotente, CAS e escritor único", async () => {
    const p = await prepareOrg("fp2-governanca");
    const first = await recordAllocation(p, { dotacaoOrcamentaria: DOT_VALUE });
    const rev1 = first.decision.revision;
    // valor diferente SEM confirmação ⇒ CONFLICT, nada muda
    const conflict = await err(() => recordAllocation(p, { dotacaoOrcamentaria: "OUTRA DOTAÇÃO" }));
    expect(conflict.data?.code ?? conflict.code).toBe("CONFLICT");
    expect(String(conflict.message)).toMatch(/BUDGET_ALLOCATION_REPLACE_UNCONFIRMED/);
    expect((await budgetState(p)).allocation.dotacao.value).toBe(DOT_VALUE);
    // com confirmação explícita ⇒ substitui; o histórico preserva a revisão anterior
    const k = key("alloc-replace");
    const replaced = await recordAllocation(p, { dotacaoOrcamentaria: "OUTRA DOTAÇÃO" }, { confirmReplace: true, idempotencyKey: k });
    expect(replaced.decision.revision).toBe(rev1 + 1);
    expect((await budgetState(p)).allocation.dotacao.value).toBe("OUTRA DOTAÇÃO");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_id = ? AND subject_type = 'procurement.source_fields'", [p.org, p.w.processId])).toBeGreaterThanOrEqual(2);
    // replay com a MESMA chave: mesma decisão, nenhuma revisão nova
    const replay = await recordAllocation(p, { dotacaoOrcamentaria: "OUTRA DOTAÇÃO" }, { confirmReplace: true, idempotencyKey: k, expectedRevision: rev1 });
    expect(replay.decision.revision).toBe(rev1 + 1);
    // CAS: revisão desatualizada com chave nova ⇒ recusada
    const stale = await err(() => recordAllocation(p, { fonteRecursos: FON_VALUE }, { expectedRevision: rev1 }));
    expect(["CONFLICT", "PRECONDITION_FAILED"]).toContain(stale.data?.code ?? stale.code);
    // escritor único: escrita genérica e CertameConfig recusam dotação/fonte
    const st = await budgetState(p);
    const generic = await err(() => tpl(p.org).governed.recordProcessFields({ confirm: true, idempotencyKey: key("gen-w"), decision: decision(), expectedRevision: st.baseDateRevision, catalogVersion: st.allocation.catalogVersion, processId: p.w.processId, source: "PROCESS", fields: { dotacaoOrcamentaria: "X" } }));
    expect(String(generic.message)).toMatch(/DERIVED_AUTHORITY_OWNED/);
    const certame = await err(() => tpl(p.org).governed.recordCertameConfig({ confirm: true, idempotencyKey: key("cfg-w"), decision: decision(), expectedRevision: st.baseDateRevision, catalogVersion: st.allocation.catalogVersion, processId: p.w.processId, source: "PROCESS", fields: { dotacaoOrcamentaria: "X" } }));
    expect(String(certame.message)).toMatch(/NOT_CERTAME_CONFIG|DERIVED_AUTHORITY_OWNED/);
    expect((await budgetState(p)).allocation.dotacao.value).toBe("OUTRA DOTAÇÃO");
  }, 600_000);

  it("F4 — RBAC e isolamento: operador recusado; outro órgão não lê nem grava", async () => {
    const a = await prepareOrg("fp2-tenant-a");
    const b = await prepareOrg("fp2-tenant-b");
    const op = await err(() => recordAllocation(a, { dotacaoOrcamentaria: DOT_VALUE }, { role: "operator" }));
    expect(op.data?.code ?? op.code).toBe("FORBIDDEN");
    const cross = await err(() => recordAllocation(a, { dotacaoOrcamentaria: DOT_VALUE }, { org: b.org }));
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(cross.data?.code ?? cross.code);
    const crossRead = await err(() => budgetState(a, b.org));
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(crossRead.data?.code ?? crossRead.code);
    expect((await budgetState(a)).allocation.dotacao.status).toBe("PENDING");
  }, 600_000);

  it("F5 — documento emitido é imutável: registrar a dotação depois não altera o oficial (só versões de trabalho a reaproveitam)", async () => {
    expect(emitted).not.toBeNull();
    const { p, officialId, content } = emitted!;
    await recordAllocation(p, { dotacaoOrcamentaria: DOT_VALUE, fonteRecursos: FON_VALUE });
    const after = (await rows("SELECT content, content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, officialId]))[0];
    expect(after.content).toBe(content);
    expect(after.content).not.toContain(DOT_VALUE);
    expect((await getState(p)).canonicalFields.find((f: any) => f.name === DOT)).toMatchObject({ status: "AUTO", displayValue: DOT_VALUE });
  }, 600_000);

  // ── R3 (gate do PR #342): minuta presa na Revisão 1 quando a dotação é registrada DEPOIS da composição ──────────────────
  const recompose = (p: P, expectedContentHash: string, opts: { confirmReplace?: boolean; idempotencyKey?: string; org?: number; role?: string } = {}) =>
    proc(opts.org ?? p.org, opts.role ?? "operator", U_AUTHOR_R3).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr),
      idempotencyKey: opts.idempotencyKey ?? key("recompose"), expectedContentHash, ...(opts.confirmReplace ? { confirmReplace: true } : {}) } as any) as Promise<any>;
  const reviewCurrent = async (p: P, editKey: string): Promise<string> => {
    const draft = (await draftText(p))!;
    const human = draft.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe.");
    if (human !== draft) await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draft), idempotencyKey: key(editKey) });
    const rs: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    for (const d of rs.structuralDeviations) await tpl(p.org, "operator", U_MANAGER).reviews.acknowledgeDeviation({ manifestId: rs.generationManifestId, blockId: d.blockId, kind: d.kind, confirm: true, idempotencyKey: key("ack"), decision: decision({ basisReference: "Revisão" }) });
    return human;
  };
  const promoteR3 = (p: P, human: string) => proc(p.org, "manager", U_MANAGER).promoteOfficial({ processId: p.w.processId, kind: "edital", idempotencyKey: key("promo-r3"), expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor." } as any) as Promise<any>;
  const officialsOf = (p: P) => rows("SELECT id, document_type t, status, version, content_hash h, content FROM official_documents WHERE tenant_id = ? AND origin = ? ORDER BY id", [p.org, p.w.processId]);
  const BODY_KEYS_9226E4B = new Set(["sources", "conditionalDecisions", "aiNarratives", "annexes", "lateBound", "deferredPublication", "humanEditRefs", "canonicalRevalidation", "lifecycleBindings"]);

  it("F6 — R3 Revisão 1: minuta sem dotação → dotação registrada depois → RECOMPOSIÇÃO governada → revisão → emissão; TR emitido intacto", async () => {
    const p = await readyTenant("fp2-r3-rev1");
    const st0: any = await getState(p);
    expect(st0.capabilities.governedDraftRecomposition).toBe(false);          // Revisão 1: sem a capability de dados de publicação
    const trBefore = (await officialsOf(p)).filter((o: any) => o.t === "tr");
    expect(trBefore.length).toBeGreaterThan(0);

    const ra1 = await gen(p);
    const human1 = await reviewCurrent(p, "e1");
    expect(human1).toContain(DOT_TEXT);
    await recordAllocation(p, { dotacaoOrcamentaria: DOT_VALUE, fonteRecursos: FON_VALUE });
    const blocked = await err(() => promoteR3(p, human1));
    expect(String(blocked.message)).toMatch(/SOURCE_CHANGED/);                // a minuta não corresponde mais às fontes

    // usuário SEM autoridade e OUTRO órgão: recusados, nada muda
    const viewer = await err(() => recompose(p, draftContentHash(human1), { role: "viewer", confirmReplace: true }));
    expect(viewer.data?.code ?? viewer.code).toBe("FORBIDDEN");
    const other = await prepareOrg("fp2-r3-outro");
    const cross = await err(() => recompose(p, draftContentHash(human1), { org: other.org, confirmReplace: true }));
    expect(["NOT_FOUND", "FORBIDDEN", "PRECONDITION_FAILED"]).toContain(cross.data?.code ?? cross.code);
    expect(await draftText(p)).toBe(human1);

    // edição humana existente ⇒ a recomposição pede confirmação explícita (nada sobrescrito sem ela)
    const needConfirm = await err(() => recompose(p, draftContentHash(human1)));
    expect(String(needConfirm.message)).toMatch(/HUMAN_EDIT_WOULD_BE_OVERWRITTEN/);
    expect(await draftText(p)).toBe(human1);

    const k = key("recompose-ok");
    const ra2 = await recompose(p, draftContentHash(human1), { confirmReplace: true, idempotencyKey: k });
    expect(ra2.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const draft2 = (await draftText(p))!;
    expect(draft2).toContain(`dotação orçamentária: ${DOT_VALUE} — Fonte de recursos: ${FON_VALUE}.`);
    expect(draft2).not.toContain(DOT_TEXT);
    expect(ra2.generationManifestId).not.toBe(ra1.generationManifestId);
    // histórico preservado: o conteúdo anterior fica no ledger de edições (operação template_compose)
    expect(await count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'edital' AND operation = 'template_compose'", [p.org, p.w.processId])).toBeGreaterThanOrEqual(1);

    // replay: o MESMO pedido não duplica versão, M1 nem histórico
    const m1Count = await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org]);
    const geradoCount = (await officialsOf(p)).filter((o: any) => o.t === "edital").length;
    const replay = await recompose(p, draftContentHash(human1), { confirmReplace: true, idempotencyKey: k });
    expect(replay.generationManifestId).toBe(ra2.generationManifestId);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org])).toBe(m1Count);
    expect((await officialsOf(p)).filter((o: any) => o.t === "edital").length).toBe(geradoCount);
    expect(await draftText(p)).toBe(draft2);

    // CAS: depois de nova revisão humana e nova mudança de fonte, um hash OBSOLETO é recusado
    const human2 = await reviewCurrent(p, "e2");
    await recordAllocation(p, { dotacaoOrcamentaria: `${DOT_VALUE} (ajustada)` }, { confirmReplace: true });
    const stale = await err(() => recompose(p, draftContentHash(draft2), { confirmReplace: true }));
    expect(stale.data?.code ?? stale.code).toBe("CONFLICT");
    expect(await draftText(p)).toBe(human2);

    // fluxo legítimo até a emissão (revisão de outro usuário; emissão pelo gestor; SoD intacta)
    await recompose(p, draftContentHash(human2), { confirmReplace: true });
    const human3 = await reviewCurrent(p, "e3");
    expect(human3).toContain(`${DOT_VALUE} (ajustada)`);
    const promoted = await promoteR3(p, human3);
    expect(promoted.promoted).toBe(true);
    const officials = await officialsOf(p);
    const issued = officials.filter((o: any) => o.t === "edital" && o.status === "emitido");
    expect(issued).toHaveLength(1);
    expect(issued[0].content).toContain(`${DOT_VALUE} (ajustada)`);
    // TR oficial: idêntico (id, versão, hash e conteúdo)
    expect(officials.filter((o: any) => o.t === "tr")).toEqual(trBefore);
    // contrato de rollback: nenhum manifest com chave desconhecida do leitor da staging 9226e4b
    for (const m of await rows("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ?", [p.org])) {
      expect(Object.keys(JSON.parse(m.b)).filter((x) => !BODY_KEYS_9226E4B.has(x))).toEqual([]);
    }
  }, 900_000);

  it("F7 — R3 elegibilidade: Revisão 1 SEM mudança de fonte mantém o comportamento legado (replay; rascunho humano intacto; nenhuma recomposição)", async () => {
    const p = await readyTenant("fp2-r3-semfonte");
    await gen(p);
    await reviewCurrent(p, "f7");
    // edição humana EXPLÍCITA (sem nenhuma mudança de fonte): o rascunho difere do que o modelo compõe
    const before = (await draftText(p))!;
    const human = `${before.replace(/\s+$/, "")}\n\nObservação acrescentada pela equipe.\n`;
    await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(before), idempotencyKey: key("f7-edit") });
    const m1Before = await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org]);
    const composeEdits = () => count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'edital' AND operation = 'template_compose'", [p.org, p.w.processId]);
    const editsBefore = await composeEdits();
    // sem mudança de fonte a recomposição NÃO é elegível: a composição atual é a MESMA do M1 ⇒ replay legado, sem tocar no rascunho
    const r: any = await recompose(p, draftContentHash(human), { confirmReplace: true });
    expect(r.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(await draftText(p)).toBe(human);                                   // edição humana preservada (nada sobrescrito)
    expect(await composeEdits()).toBe(editsBefore);                           // nenhuma recomposição registrada
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org])).toBe(m1Before);
  }, 600_000);

  // ── X → Y → X (gate do PR #342): a fonte volta a um valor já usado; a composição reproduz um M1 EXISTENTE ─────────────────
  async function readyRev2(label: string): Promise<P> {
    const org = newOrg();
    const w = await seedWorld(conn, org, label, { flagOn: true });
    const tr = await seedOfficialTr(conn, w, 1, "TERMO DE REFERÊNCIA — conteúdo sintético v1", TR_META);
    const p: P = { org, w, tr, model: await publishBllModel(org, 2, key) };
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p)); await fillTrueDecisions(p);
    return p;
  }
  const composeEdits = (p: P) => count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'edital' AND operation = 'template_compose'", [p.org, p.w.processId]);
  async function runXYX(p: P, rev: 1 | 2): Promise<void> {
    const X = `${DOT_VALUE} [X]`, Y = `${DOT_VALUE} [Y]`;
    expect((await getState(p)).capabilities.governedDraftRecomposition).toBe(rev === 2);
    await gen(p);
    let human = await reviewCurrent(p, `xyx-a-${rev}`);
    // X
    await recordAllocation(p, { dotacaoOrcamentaria: X, fonteRecursos: FON_VALUE });
    const rB = await recompose(p, draftContentHash(human), { confirmReplace: true });
    human = await reviewCurrent(p, `xyx-b-${rev}`);
    expect(human).toContain(X);
    // Y
    await recordAllocation(p, { dotacaoOrcamentaria: Y }, { confirmReplace: true });
    const rC = await recompose(p, draftContentHash(human), { confirmReplace: true });
    expect(rC.generationManifestId).not.toBe(rB.generationManifestId);
    human = await reviewCurrent(p, `xyx-c-${rev}`);
    expect(human).toContain(Y);
    const m1Before = await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org]);
    const geradoBefore = (await officialsOf(p)).filter((o: any) => o.t === "edital").length;
    // VOLTA a X: a composição reproduz o M1 de B (já existente); o rascunho precisa ser ressincronizado — nada pode ficar preso
    await recordAllocation(p, { dotacaoOrcamentaria: X }, { confirmReplace: true });
    const blocked = await err(() => promoteR3(p, human));
    expect(String(blocked.message)).toMatch(/SOURCE_CHANGED/);
    const editsBefore = await composeEdits(p);
    // concorrência: dois pedidos com o MESMO hash visto ⇒ uma única recomposição efetiva, sem duplicidade nem corrupção
    const [c1, c2] = await Promise.allSettled([
      recompose(p, draftContentHash(human), { confirmReplace: true, idempotencyKey: key("xyx-k1") }),
      recompose(p, draftContentHash(human), { confirmReplace: true, idempotencyKey: key("xyx-k2") }),
    ]);
    expect([c1, c2].some((x) => x.status === "fulfilled")).toBe(true);
    for (const x of [c1, c2]) if (x.status === "rejected") expect(String((x.reason as Error).message)).toMatch(/O rascunho mudou desde o carregamento|CONFLICT/);
    const back = [c1, c2].find((x) => x.status === "fulfilled") as PromiseFulfilledResult<any>;
    expect(back.value.generationManifestId).toBe(rB.generationManifestId);                   // M1 de B reutilizado (sem M1 novo)
    expect(await composeEdits(p)).toBe(editsBefore + 1);                                      // uma recomposição no histórico
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org])).toBe(m1Before);
    expect((await officialsOf(p)).filter((o: any) => o.t === "edital").length).toBe(geradoBefore);   // nenhuma versão técnica nova
    const draftX = (await draftText(p))!;
    expect(draftX).toContain(X);
    expect(draftX).not.toContain(Y);
    const rs: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(rs.generationManifestId).toBe(rB.generationManifestId);                           // a revisão usa o vínculo vigente da minuta
    // replay do MESMO pedido: idempotente
    const again: any = await recompose(p, draftContentHash(human), { confirmReplace: true, idempotencyKey: (c1.status === "fulfilled" ? key("xyx-k1-r") : key("xyx-k2-r")) });
    expect(again.generationManifestId).toBe(rB.generationManifestId);
    expect(again.replayed).toBe(true);                                                         // já vinculado ⇒ replay puro
    expect(await composeEdits(p)).toBe(editsBefore + 1);
    // X → Y → X → Y → X: ciclos repetidos ao MESMO M1 (o hash visto pode se repetir) — sem colisão de idempotência, sem M1/versão novos
    await recordAllocation(p, { dotacaoOrcamentaria: Y }, { confirmReplace: true });
    const toY: any = await recompose(p, draftContentHash(draftX), { confirmReplace: true });
    expect(toY.generationManifestId).toBe(rC.generationManifestId);
    expect(toY.replayed).toBe(false);
    expect((await draftText(p))!).toContain(Y);
    await recordAllocation(p, { dotacaoOrcamentaria: X }, { confirmReplace: true });
    const toX: any = await recompose(p, draftContentHash((await draftText(p))!), { confirmReplace: true });
    expect(toX.generationManifestId).toBe(rB.generationManifestId);
    expect(await draftText(p)).toBe(draftX);
    expect(await composeEdits(p)).toBe(editsBefore + 3);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org])).toBe(m1Before);
    expect((await officialsOf(p)).filter((o: any) => o.t === "edital").length).toBe(geradoBefore);
    // revisão e emissão com SoD
    const finalHuman = await reviewCurrent(p, `xyx-d-${rev}`);
    const promoted = await promoteR3(p, finalHuman);
    expect(promoted.promoted).toBe(true);
    const issued = (await officialsOf(p)).filter((o: any) => o.t === "edital" && o.status === "emitido");
    expect(issued).toHaveLength(1);
    expect(issued[0].content).toContain(X);
    for (const m of await rows("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ?", [p.org])) {
      expect(Object.keys(JSON.parse(m.b)).filter((x) => !BODY_KEYS_9226E4B.has(x))).toEqual([]);
    }
  }

  it("F8 — X → Y → X (→ Y → X) na Revisão 1: a minuta volta ao M1 de X, é revisada e emitida; sem M1/versão duplicados; concorrência segura", async () => {
    const p = await readyTenant("fp2-xyx-rev1");
    const trBefore = (await officialsOf(p)).filter((o: any) => o.t === "tr");
    await runXYX(p, 1);
    expect((await officialsOf(p)).filter((o: any) => o.t === "tr")).toEqual(trBefore);
  }, 900_000);

  it("F9 — X → Y → X na Revisão 2 (capability): mesmo comportamento", async () => {
    const p = await readyRev2("fp2-xyx-rev2");
    const trBefore = (await officialsOf(p)).filter((o: any) => o.t === "tr");
    await runXYX(p, 2);
    expect((await officialsOf(p)).filter((o: any) => o.t === "tr")).toEqual(trBefore);
  }, 900_000);

  // ── Correções A1–A4 (homologação H1–H5 em staging, 05/11/2026) ─────────────────────────────────────────────────────────────
  /** Decide o SRP pelo MESMO plano de gravação da tela (CAS/idempotência das rotas governadas). */
  async function setSrp(p: P, value: boolean): Promise<void> {
    const st: any = await getState(p);
    const sec = st.sections.find((x: any) => x.fields.some((f: any) => f.name === "controle.utilizaSrp"));
    const f = sec.fields.find((x: any) => x.name === "controle.utilizaSrp");
    const plan = buildSavePlan(st, { edits: { [sec.source]: { [f.path]: toFormValue(f, value) } } as any });
    expect(plan.errors).toEqual({});
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st), stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
  }
  const preparedTenant = async (label: string): Promise<P> => {
    const p = await prepareOrg(label);
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p));
    return p;
  };
  const SRP_POLICIES = ["decisao.adesaoAta", "srp.marcoInicialVigenciaAta", "srp.prazoAssinaturaAta"];
  const profileOf = (p: P, withProcess: boolean) => proc(p.org).licitacoesProfile({ ...(withProcess ? { processId: p.w.processId } : {}), ...WS }) as Promise<any>;
  const profileField = (st: any, n: string) => st.sections.flatMap((x: any) => x.fields).find((f: any) => f.name === n);

  it("F10 — A1: SRP INDEFINIDO não é presumido (pendência informativa); SRP sim ⇒ não aplicável; SRP não ⇒ pendência", async () => {
    const p = await preparedTenant("fp2-a1-srp");
    const st0: any = await getState(p);
    expect(fieldOf(st0, "controle.utilizaSrp")?.hasValue ?? false).toBe(false);                // SRP ainda não decidido
    for (const n of [DOT, FON]) {
      expect(fieldOf(st0, n), n).toMatchObject({ status: "CONTENT_PENDING", entry: "PROCESS_BUDGET" });   // antes: NOT_APPLICABLE "registro de preços"
      expect(JSON.stringify(fieldOf(st0, n).origin)).not.toMatch(/registro de preços/i);
    }
    expect(st0.upstream.contentPending.map((c: any) => c.name).sort()).toEqual([DOT, FON]);
    expect((await budgetState(p)).allocation).toMatchObject({ srp: null, dotacao: { status: "PENDING" }, fonte: { status: "PENDING" } });   // MESMA leitura nos dois lugares

    await setSrp(p, true);
    const st1: any = await getState(p);
    for (const n of [DOT, FON]) expect(fieldOf(st1, n), n).toMatchObject({ status: "NOT_APPLICABLE", origin: { label: expect.stringMatching(/registro de preços/) } });
    expect(st1.upstream.contentPending).toEqual([]);
    expect((await budgetState(p)).allocation).toMatchObject({ srp: true, dotacao: { status: "NOT_APPLICABLE" } });

    await setSrp(p, false);
    const st2: any = await getState(p);
    for (const n of [DOT, FON]) expect(fieldOf(st2, n), n).toMatchObject({ status: "CONTENT_PENDING" });
    expect((await budgetState(p)).allocation).toMatchObject({ srp: false, dotacao: { status: "PENDING" } });
  }, 600_000);

  it("F11 — A4: perfil geral × contextual: as 3 políticas de SRP aparecem como exigidas pelo processo SRP (sem valor atribuído); preflight nomeia os campos", async () => {
    const p = await preparedTenant("fp2-a4-srp");
    // GERAL (sem processo): campos gerais completos, mas SEM falso "completo" — as condicionais ficam visíveis com o motivo
    const general = await profileOf(p, false);
    expect(general.contextual).toBe(false);
    expect(general.summary.pendingCount).toBe(0);
    expect(general.conditional.map((c: any) => c.name)).toEqual(expect.arrayContaining(SRP_POLICIES));
    for (const n of SRP_POLICIES) {
      expect(profileField(general, n), n).toMatchObject({ status: "OPTIONAL", hasValue: false, reason: "Exigido apenas quando: Sistema de Registro de Preços (SRP): Sim." });
    }
    // processo com SRP indefinido: nada é exigido agora (não presume SRP)
    expect((await profileOf(p, true)).summary.contextPending).toBe(0);

    await setSrp(p, true);
    const ctx = await profileOf(p, true);
    expect(ctx.contextual).toBe(true);
    expect(ctx.summary.contextPending).toBe(3);
    expect(ctx.summary.pendingCount).toBe(3);                                    // antes: 0 ("Perfil completo") com o Edital bloqueado
    for (const n of SRP_POLICIES) {
      expect(profileField(ctx, n), n).toMatchObject({ status: "PENDING", hasValue: false, reason: "Exigido neste processo (Sistema de Registro de Preços (SRP): Sim)." });
      expect(profileField(ctx, n).currentValue).toBeUndefined();                // nenhum valor atribuído automaticamente
    }
    const st: any = await getState(p);
    const pend = st.upstream.profilePending.filter((x: any) => SRP_POLICIES.includes(x.name));
    expect(pend.map((x: any) => x.name).sort()).toEqual([...SRP_POLICIES].sort());
    for (const x of pend) expect(x.reason).toBe("política do órgão ainda não registrada — exigida neste processo (Sistema de Registro de Preços (SRP): Sim)");
    const pf = await preflight(p);
    expect(pf.status).toBe("BLOCKED");                                          // requisito vinculante preservado (nada afrouxado)
    const issue = pf.issues.find((i: any) => i.code === "LICITACOES_PROFILE_INCOMPLETE");
    expect(issue.message).toMatch(/^Perfil institucional de Licitações incompleto para este processo \(\d+ campo\(s\): /);
    for (const n of SRP_POLICIES) expect(issue.message).toContain(profileField(ctx, n).description);
    expect(issue.message).toContain("Configurações → Perfil de Licitações");

    // a pessoa informa no Perfil (órgão SINTÉTICO do teste), pelo mesmo plano da tela: só os 3 exigidos; o resto do perfil é preservado
    const before = await profileOf(p, false);
    const keep = Object.fromEntries(before.sections.flatMap((x: any) => x.fields).filter((f: any) => f.hasValue).map((f: any) => [f.name, f.currentValue]));
    const r = await completeProfile(harnessOf(p));
    expect(r.policiesTyped).toBe(3);
    const after = await profileOf(p, true);
    expect(after.summary.contextPending).toBe(0);
    expect(after.summary.pendingCount).toBe(0);
    for (const [n, v] of Object.entries(keep)) expect(profileField(after, n).currentValue, n).toEqual(v);
    expect((await profileOf(p, false)).conditional.map((c: any) => c.name)).not.toEqual(expect.arrayContaining(SRP_POLICIES));
    expect((await preflight(p)).issues?.some((i: any) => i.code === "LICITACOES_PROFILE_INCOMPLETE") ?? false).toBe(false);
  }, 600_000);

  it("F12 — A4/C1: condição que depende SÓ de política do órgão, ativa ⇒ pendência GERAL do Perfil (sem processo), nunca 'condicional'", async () => {
    const p = await preparedTenant("fp2-a4-c1");
    const st0 = await profileOf(p, false);
    expect(profileField(st0, "habilitacao.registroCadastralAceito")).toMatchObject({ status: "OPTIONAL", hasValue: false });
    // o órgão registra que aceita registro cadastral (política própria, órgão SINTÉTICO do teste), pelo mesmo plano da tela
    const sec = st0.sections.find((x: any) => x.fields.some((f: any) => f.name === "decisao.aceitaRegistroCadastral"));
    const f = sec.fields.find((x: any) => x.name === "decisao.aceitaRegistroCadastral");
    const view = profileAsPrepView(st0);
    const plan = buildSavePlan(view, { edits: { [sec.source]: { [f.path]: toFormValue(f, true) } } as any });
    expect(plan.errors).toEqual({});
    const out = await executeSavePlan(plan.writes, view.revisions, {
      async write(w: PlannedWrite, expectedRevision: number) {
        const r: any = await tpl(p.org).governed.recordOrganizationFields({ confirm: true, idempotencyKey: key(w.id), decision: decision(), expectedRevision, catalogVersion: st0.catalogVersion, source: w.source as any, fields: w.fields ?? {} });
        return { revision: r.decision.revision as number };
      },
    }, stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
    const st1 = await profileOf(p, false);
    expect(profileField(st1, "habilitacao.registroCadastralAceito")).toMatchObject({ status: "PENDING", hasValue: false, reason: expect.stringMatching(/^Exigido porque o órgão registrou: /) });
    expect(st1.summary.pendingCount).toBe(st0.summary.pendingCount + 1);
    expect(st1.conditional.map((c: any) => c.name)).not.toContain("habilitacao.registroCadastralAceito");
    expect(profileField(st1, "habilitacao.registroCadastralAceito").currentValue).toBeUndefined();   // nada atribuído
  }, 600_000);
});
