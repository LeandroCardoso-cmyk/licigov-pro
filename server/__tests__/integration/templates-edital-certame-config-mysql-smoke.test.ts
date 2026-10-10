/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR #288 — CERTAME CONFIG AUTHORITY CLOSURE — MySQL REAL, dados SINTÉTICOS, pelas MESMAS rotas e planos da tela.
 *
 *  C1  principal + MÉTRICA: tenant configurado (Perfil + plataforma) → plataforma/orçamento/itens/ciclo de vida AUTOMÁTICOS; só decisões
 *      genuínas ficam visíveis; Edital → M1 → revisão → M2
 *  C2  revisão do Perfil da plataforma ⇒ SOURCE_CHANGED no M1 pendente; documento emitido imutável; processo novo usa a nova revisão
 *  C3  origens: divulgação do orçamento e regime de participação ausentes ⇒ pendência NA ORIGEM (sem campo no Edital); depois de registrados ⇒ AUTO
 *  C4  autoridades derivadas não aceitam escrita humana no Edital; CertameConfig só aceita decisões do certame; isolamento de tenant
 *  C5  cronograma: sem regra declarada ⇒ datas independentes; com regra da plataforma ⇒ derivado; nunca presumido
 *  C6  número do pregão persistido UMA vez (CertameConfig) e não copiado de outro processo; replay idempotente
 * Só roda com DATABASE_URL. Nenhum dado real, nenhum processo 2026/253, nenhum modelo de produção.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
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
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, SYNTHETIC_PLATFORMS, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedExtraProcess, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 987_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-zre`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-zre-${org}-${userId}`, requestId: `req-zre-${org}` } as any;
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
/** Segundo processo do MESMO órgão (outro nº, itens e TR próprios). */
async function addProcess(base: P, label: string, seq: number, trMeta: Record<string, unknown> | null = TR_META): Promise<P> {
  const w = await seedExtraProcess(base.org, label, seq);
  const tr = await seedOfficialTr(conn, w, 1, `TERMO DE REFERÊNCIA — ${label}`, trMeta ?? undefined);
  return { ...base, w, tr };
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
const profileState = async (p: P): Promise<any> => proc(p.org).licitacoesProfile({ processId: p.w.processId, ...WS });
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


const METRICS: Record<string, unknown> = {};
const derivedNames = ["processo.enderecoEletronicoBll", "processo.regulamentoBllVersao", "julgamento.dataOrcamentoEstimado", "decisao.formaJulgamento", "julgamento.regimeParticipacao", "processo.dataEmissaoEdital"];
const fieldOf = (st: any, name: string) => [...st.sections.flatMap((s: any) => s.fields), ...st.canonicalFields].find((f: any) => f.name === name);
const todayBr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe.skipIf(!DB)("PR #288 — CertameConfig como autoridade (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "certame-config-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (ORGS.length) await conn.query(`DELETE FROM procurement_context_facts WHERE organization_id IN (${ORGS.map(() => "?").join(",")})`, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
    // eslint-disable-next-line no-console
    console.log("[CERTAME_CONFIG METRICS]", JSON.stringify(METRICS));
  }, 120_000);

  it("C1 — tenant configurado: plataforma, orçamento, itens e ciclo de vida são AUTOMÁTICOS; só decisões independentes ficam visíveis; Edital → M1 → M2", async () => {
    const p = await prepareOrg("c1");
    // 1º uso: configuração ÚNICA do órgão (perfil + plataforma) e as origens (TR estruturado, orçamento, itens)
    await completeProfile(harnessOf(p));
    await fillTrStamped(p);
    const before = await getState(p);
    // sem origens registradas: pendência NA ORIGEM, nunca campo do Edital
    expect(fieldOf(before, "julgamento.regimeParticipacao")).toMatchObject({ status: "PENDING_SOURCE", entry: "ITEMS" });
    const prefBefore = await preflight(p);
    expect(prefBefore.status).toBe("BLOCKED");
    expect(JSON.stringify(prefBefore.issues)).toContain("SOURCE_PENDING");
    await setBudgetDisclosure(harnessOf(p));
    await setItemsParticipation(harnessOf(p));

    const st = await getState(p);
    expect(fieldOf(st, "processo.enderecoEletronicoBll")).toMatchObject({ status: "AUTO", displayValue: SYNTHETIC_PLATFORMS.bll.enderecoEletronico, authority: "PLATFORM_PROFILE" });
    expect(fieldOf(st, "processo.regulamentoBllVersao")).toMatchObject({ status: "AUTO", displayValue: SYNTHETIC_PLATFORMS.bll.regulamentoVersao });
    expect(fieldOf(st, "julgamento.dataOrcamentoEstimado")).toMatchObject({ status: "AUTO", displayValue: todayBr(), authority: "UPSTREAM_PRICE_RESEARCH" });
    expect(fieldOf(st, "decisao.formaJulgamento")).toMatchObject({ status: "AUTO", displayValue: "item", authority: "UPSTREAM_ITEMS" });
    expect(fieldOf(st, "julgamento.regimeParticipacao")).toMatchObject({ status: "AUTO", authority: "UPSTREAM_ITEMS" });
    expect(fieldOf(st, "processo.dataEmissaoEdital")).toMatchObject({ status: "AUTO", authority: "LIFECYCLE_SYSTEM", displayValue: todayBr() });
    // nenhuma autoridade derivada é editável nem pendente no Edital
    const live = livePendingItems(st, {});
    for (const n of derivedNames) expect(live.map((i) => i.field.name), n).not.toContain(n);
    for (const n of derivedNames) expect(st.sections.flatMap((s: any) => s.fields).find((f: any) => f.name === n && f.editable), n).toBeUndefined();
    // a divulgação não é campo do Edital (consumida da origem)
    expect(st.budgetDisclosure).toBe("publico");
    const m = st.metrics;
    for (const f of live) expect(["CERTAME_CONFIG", "CERTAME_SCHEDULE", "CONDITIONAL"], f.field.name).toContain(f.field.authority);

    // decisões genuínas → preflight → M1 → revisão → M2
    const typed = await fillTrueDecisions(p);
    const pre = await preflight(p);
    expect(pre.status).toBe("READY_FOR_COMPOSITION");
    const issued = await reviewAndIssue(p);
    expect(issued.officialId).toBeTruthy();
    // a data de emissão do documento é a do evento de composição (sistema), nunca digitada
    expect(await draftText(p)).toBeTruthy();
    METRICS.C1 = {
      TOTAL_TEMPLATE_VARIABLES: m.TOTAL_TEMPLATE_FIELDS, BEFORE_VISIBLE_DECISIONS_PILOT: 21, AUTO_FROM_PLATFORM: m.AUTO_FROM_PLATFORM, AUTO_FROM_PRICE_RESEARCH: m.AUTO_FROM_PRICE_RESEARCH,
      AUTO_FROM_ITEMS: m.AUTO_FROM_ITEMS, AUTO_FROM_CERTAME_CONFIG: m.AUTO_FROM_CERTAME_CONFIG, AUTO_FROM_SCHEDULE: m.AUTO_FROM_SCHEDULE, AUTO_FROM_LIFECYCLE: m.AUTO_FROM_LIFECYCLE,
      ORG_DEFAULTS_APPLIED: m.ORG_DEFAULTS_APPLIED, TRUE_NEW_DECISIONS_VISIBLE: live.length, TRUE_NEW_DECISIONS_VISIBLE_WITH_CASCADE: typed.length,
      visible: live.map((i) => `${i.field.name} [${i.field.authority}]`),
    };
    expect(live.length).toBeLessThanOrEqual(21);
  }, 180_000);

  it("C2 — revisão do Perfil da plataforma ⇒ SOURCE_CHANGED no M1 pendente; emitido imutável; processo novo usa a revisão nova", async () => {
    const a = await prepareOrg("c2");
    await completeProfile(harnessOf(a)); await fillTrStamped(a); await setBudgetDisclosure(harnessOf(a)); await setItemsParticipation(harnessOf(a));
    await fillTrueDecisions(a);
    const first = await gen(a);
    const revalidation = async (p: P) => (await proc(p.org).editalTemplateReviewState({ processId: p.w.processId }) as any).revalidation;
    expect((await revalidation(a)).status).toBe("PASSED");
    const prof = await profileState(a);
    expect(prof.platforms[0]).toMatchObject({ slug: "bll", missing: 0 });
    await tpl(a.org).governed.recordLicitacoesProfile({
      confirm: true, idempotencyKey: key("plat2"), decision: decision(), expectedRevision: prof.revision, catalogVersion: prof.catalogVersion,
      platforms: { bll: { ...SYNTHETIC_PLATFORMS.bll, regulamentoVersao: "Regulamento da plataforma BLL — NOVA versão 2026-09" } },
    });
    const rv = await revalidation(a);
    expect(rv.status).toBe("BLOCKED");
    expect(JSON.stringify(rv.issues)).toContain("SOURCE_CHANGED");
    // voltar ao valor original ⇒ as fontes coincidem de novo (append-only: a história permanece)
    const prof2 = await profileState(a);
    await tpl(a.org).governed.recordLicitacoesProfile({
      confirm: true, idempotencyKey: key("plat3"), decision: decision(), expectedRevision: prof2.revision, catalogVersion: prof2.catalogVersion, platforms: SYNTHETIC_PLATFORMS,
    });
    expect((await revalidation(a)).status).toBe("PASSED");
    const issued = await reviewAndIssue(a);
    const emitted = (await rows("SELECT content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [a.org, issued.officialId]))[0].h;
    // nova revisão da plataforma: o EMITIDO não muda; um processo novo do mesmo órgão usa a revisão vigente
    const prof3 = await profileState(a);
    await tpl(a.org).governed.recordLicitacoesProfile({
      confirm: true, idempotencyKey: key("plat4"), decision: decision(), expectedRevision: prof3.revision, catalogVersion: prof3.catalogVersion,
      platforms: { bll: { ...SYNTHETIC_PLATFORMS.bll, regulamentoVersao: "Regulamento da plataforma BLL — NOVA versão 2026-09" } },
    });
    expect((await rows("SELECT content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [a.org, issued.officialId]))[0].h).toBe(emitted);
    const b = await addProcess(a, "c2b", 2);
    await fillTrStamped(b); await setBudgetDisclosure(harnessOf(b)); await setItemsParticipation(harnessOf(b));
    expect(fieldOf(await getState(b), "processo.regulamentoBllVersao")).toMatchObject({ status: "AUTO", displayValue: "Regulamento da plataforma BLL — NOVA versão 2026-09" });
    expect(first.generationManifestId).toBeTruthy();
  }, 240_000);

  it("C3 — origens ausentes viram pendência NA ORIGEM (com ação), sem campo redundante no Edital; registradas ⇒ AUTO e preflight avança", async () => {
    const p = await prepareOrg("c3");
    await completeProfile(harnessOf(p), { platforms: null });   // perfil SEM plataforma
    await fillTrStamped(p);
    const st = await getState(p);
    expect(fieldOf(st, "processo.enderecoEletronicoBll")).toMatchObject({ status: "PENDING_SOURCE", entry: "PLATFORM_PROFILE" });
    expect(fieldOf(st, "julgamento.regimeParticipacao")).toMatchObject({ status: "PENDING_SOURCE", entry: "ITEMS" });
    expect(fieldOf(st, "controle.orcamentoSigilosoSimNao")).toMatchObject({ status: "PENDING_SOURCE", entry: "PRICE_RESEARCH" });
    expect(st.upstream.sourcePending.map((x: any) => x.fix)).toEqual(expect.arrayContaining(["PLATFORM_PROFILE", "ITEMS", "PRICE_RESEARCH"]));
    expect(st.sections.flatMap((s: any) => s.fields).some((f: any) => f.editable && ["processo.enderecoEletronicoBll", "julgamento.regimeParticipacao", "controle.orcamentoSigilosoSimNao"].includes(f.name))).toBe(false);
    await fillTrueDecisions(p);
    const blocked = await preflight(p);
    expect(blocked.status).toBe("BLOCKED");
    const codes = JSON.stringify(blocked.issues);
    expect(codes).toContain("SOURCE_PENDING");
    expect(codes).toContain("PLATFORM_PROFILE");
    // resolve NA ORIGEM
    const prof = await profileState(p);
    await tpl(p.org).governed.recordLicitacoesProfile({ confirm: true, idempotencyKey: key("plat"), decision: decision(), expectedRevision: prof.revision, catalogVersion: prof.catalogVersion, platforms: SYNTHETIC_PLATFORMS });
    await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p));
    const after = await getState(p);
    expect(after.upstream.sourcePending).toEqual([]);
    expect((await preflight(p)).status).toBe("READY_FOR_COMPOSITION");
  }, 180_000);

  it("C4 — derivadas não aceitam escrita humana no Edital; CertameConfig só aceita decisões do certame; tenant isolado", async () => {
    const a = await prepareOrg("c4a");
    const b = await prepareOrg("c4b");
    await completeProfile(harnessOf(a));
    const stA = await getState(a);
    const base = (k: string, rev: number) => ({ confirm: true as const, idempotencyKey: key(k), decision: decision(), expectedRevision: rev, catalogVersion: stA.catalogVersion });
    const e1 = await tpl(a.org).governed.recordProcessFields({ ...base("d1", stA.revisions.process), processId: a.w.processId, source: "CERTAME_CONFIG", fields: { enderecoEletronicoBll: "https://forjado.example" } }).then(() => null, (e: any) => e);
    expect(String(e1?.message)).toContain("DERIVED_AUTHORITY_OWNED");
    const e2 = await tpl(a.org).governed.recordProcessFields({ ...base("d2", stA.revisions.process), processId: a.w.processId, source: "LIFECYCLE", fields: { dataEmissaoEdital: "2026-01-01" } }).then(() => null, (e: any) => e);
    expect(String(e2?.message)).toContain("DERIVED_AUTHORITY_OWNED");
    const e3 = await tpl(a.org).governed.recordCertameConfig({ ...base("d3", stA.revisions.process), processId: a.w.processId, source: "PROCESS", fields: { fiscalContrato: "Fiscal X" } }).then(() => null, (e: any) => e);
    expect(String(e3?.message)).toContain("NOT_CERTAME_CONFIG");
    // decisão legítima do certame passa
    const ok: any = await tpl(a.org).governed.recordCertameConfig({ ...base("d4", stA.revisions.process), processId: a.w.processId, source: "PROCESS", fields: { utilizaSrp: false } });
    expect(ok.decision.revision).toBe(stA.revisions.process + 1);
    // tenant: o perfil/plataforma e a configuração de A nunca aparecem em B; processo de A inacessível por B
    const stB = await getState(b);
    expect(fieldOf(stB, "processo.enderecoEletronicoBll")).toMatchObject({ status: "PENDING_SOURCE" });
    expect(stB.revisions.process).toBe(0);
    const cross = await proc(b.org).certameConfig({ processId: a.w.processId, ...WS }).then(() => null, (e: any) => e);
    expect(cross).not.toBeNull();
    const crossWrite = await tpl(b.org).governed.recordCertameConfig({ ...base("d5", 0), processId: a.w.processId, source: "PROCESS", fields: { utilizaSrp: true } }).then(() => null, (e: any) => e);
    expect(crossWrite).not.toBeNull();
  }, 180_000);

  it("C5 — cronograma: sem regra declarada ⇒ datas independentes; com a regra da plataforma ⇒ derivado (nada presumido)", async () => {
    const a = await prepareOrg("c5a");
    await completeProfile(harnessOf(a));                                                           // sem regra de cronograma
    await fillTrStamped(a); await setBudgetDisclosure(harnessOf(a)); await setItemsParticipation(harnessOf(a));
    const pendA = livePendingItems(await getState(a), {}).map((i) => i.field.name);
    for (const n of ["controle.dataDivulgacaoPrevista", "processo.dataAbertura", "processo.dataFimRecebimentoPropostas", "processo.dataInicioRecebimentoPropostas"]) expect(pendA, n).toContain(n);

    const b = await prepareOrg("c5b");
    await completeProfile(harnessOf(b), { platforms: { bll: { ...SYNTHETIC_PLATFORMS.bll, cronograma: { limitePropostas: "ABERTURA_DA_SESSAO", inicioPropostas: "PUBLICACAO", horarioInicioPropostas: "08:00" } } } });
    await fillTrStamped(b); await setBudgetDisclosure(harnessOf(b)); await setItemsParticipation(harnessOf(b));
    const stB0 = await getState(b);
    // base ausente ⇒ nada derivado ainda E as derivadas não viram decisão: só as datas independentes pendentes
    const pendB0 = livePendingItems(stB0, {}).map((i) => i.field.name);
    expect(pendB0).toEqual(expect.arrayContaining(["controle.dataDivulgacaoPrevista", "processo.dataAbertura"]));
    for (const n of ["processo.dataFimRecebimentoPropostas", "processo.dataInicioRecebimentoPropostas", "processo.horarioFimRecebimentoPropostas"]) {
      expect(pendB0, n).not.toContain(n);
      expect(fieldOf(stB0, n), n).toMatchObject({ editable: false });
    }
    // a pessoa decide SÓ as independentes (dataDivulgacaoPrevista, dataAbertura, horarioAbertura)
    await fillTrueDecisions(b);
    const stB = await getState(b);
    const fim = fieldOf(stB, "processo.dataFimRecebimentoPropostas");
    expect(fim).toMatchObject({ status: "AUTO", editable: false, displayValue: scenarioValueByName("processo.dataAbertura") });
    expect(fieldOf(stB, "processo.horarioFimRecebimentoPropostas")).toMatchObject({ status: "AUTO", editable: false, displayValue: scenarioValueByName("processo.horarioAbertura") });
    expect(fieldOf(stB, "processo.dataInicioRecebimentoPropostas")).toMatchObject({ status: "AUTO", editable: false, displayValue: `${scenarioValueByName("controle.dataDivulgacaoPrevista")}T08:00` });
    expect(livePendingItems(stB, {}).map((i) => i.field.name)).toEqual([]);
    expect((await preflight(b)).status).toBe("READY_FOR_COMPOSITION");
    METRICS.C5 = { derivedByPlatformRule: ["dataFimRecebimentoPropostas", "horarioFimRecebimentoPropostas", "dataInicioRecebimentoPropostas"], metrics: stB.metrics.AUTO_FROM_SCHEDULE };
  }, 240_000);

  it("C6 — número do pregão persistido UMA vez na CertameConfig, lido por outros documentos e nunca copiado de outro processo; replay idempotente", async () => {
    const a = await prepareOrg("c6");
    await completeProfile(harnessOf(a));
    const st = await getState(a);
    const numero = scenarioValueByName("processo.numeroPregao") as string;
    const act = { confirm: true as const, idempotencyKey: key("numero"), decision: decision(), catalogVersion: st.catalogVersion, processId: a.w.processId, source: "PROCESS" as const, fields: { numeroPregao: numero }, expectedRevision: st.revisions.process };
    const r1: any = await tpl(a.org).governed.recordCertameConfig(act);
    const r2: any = await tpl(a.org).governed.recordCertameConfig(act);                   // retry de rede
    expect(r2.replayed).toBe(true);
    expect(r2.decision.id).toBe(r1.decision.id);
    const cfg: any = await proc(a.org).certameConfig({ processId: a.w.processId, ...WS });
    expect(cfg).toMatchObject({ status: "READY", numeroPregao: numero });
    expect(cfg.fields.find((f: any) => f.name === "processo.numeroPregao")).toMatchObject({ status: "DECIDED", value: numero });
    expect(fieldOf(await getState(a), "processo.numeroPregao")).toMatchObject({ status: "DECIDED", displayValue: numero });
    // outro processo do MESMO órgão: nada é copiado do "último processo"
    const b = await addProcess(a, "c6b", 2);
    expect(fieldOf(await getState(b), "processo.numeroPregao")).toMatchObject({ status: "PENDING" });
    const cfgB: any = await proc(b.org).certameConfig({ processId: b.w.processId, ...WS });
    expect(cfgB.numeroPregao).toBeNull();
  }, 180_000);
  it("C7 — MÉTRICA: tenant totalmente configurado (plataforma com regra de cronograma + padrões explícitos) × processo seguinte: só decisões genuinamente independentes", async () => {
    const a = await prepareOrg("c7");
    const defaults = Object.fromEntries(["julgamento.modoDisputa", "julgamento.prazoValidadeProposta", "julgamento.parametroExequibilidade", "processo.horarioAbertura"].map((n) => [n, scenarioValueByName(n)]));
    await completeProfile(harnessOf(a), {
      defaults, platforms: { bll: { ...SYNTHETIC_PLATFORMS.bll, cronograma: { limitePropostas: "ABERTURA_DA_SESSAO", inicioPropostas: "PUBLICACAO", horarioInicioPropostas: "08:00" } } },
    });
    await fillTrStamped(a); await setBudgetDisclosure(harnessOf(a)); await setItemsParticipation(harnessOf(a));
    const first = await getState(a);
    const visA = livePendingItems(first, {});
    // processo SEGUINTE do mesmo órgão (perfil, plataforma e padrões reutilizados; TR estruturado do processo)
    const b = await addProcess(a, "c7b", 2);
    await fillTrStamped(b); await setBudgetDisclosure(harnessOf(b)); await setItemsParticipation(harnessOf(b));
    const second = await getState(b);
    const visB = livePendingItems(second, {});
    const mB = second.metrics;
    METRICS.C7 = {
      BEFORE_VISIBLE_DECISIONS_PILOT: 21, TOTAL_TEMPLATE_VARIABLES: mB.TOTAL_TEMPLATE_FIELDS,
      AUTO_FROM_PLATFORM: mB.AUTO_FROM_PLATFORM, AUTO_FROM_PRICE_RESEARCH: mB.AUTO_FROM_PRICE_RESEARCH, AUTO_FROM_ITEMS: mB.AUTO_FROM_ITEMS,
      AUTO_FROM_CERTAME_CONFIG: mB.AUTO_FROM_CERTAME_CONFIG, AUTO_FROM_SCHEDULE: mB.AUTO_FROM_SCHEDULE, AUTO_FROM_LIFECYCLE: mB.AUTO_FROM_LIFECYCLE,
      ORG_DEFAULTS_APPLIED: mB.ORG_DEFAULTS_APPLIED, INSTITUTIONAL_PROFILE_REENTRY_SUBSEQUENT: (second.upstream?.profilePending ?? []).length,
      TRUE_NEW_DECISIONS_VISIBLE_FIRST: visA.length, TRUE_NEW_DECISIONS_VISIBLE: visB.length, visible: visB.map((i) => `${i.field.name} [${i.field.authority}]`),
    };
    expect(visB.map((i) => i.field.name)).toEqual(visA.map((i) => i.field.name));
    expect((second.upstream?.profilePending ?? []).length).toBe(0);
    expect(mB.AUTO_FROM_SCHEDULE).toBe(1);       // horário-limite = horário da sessão (padrão institucional) pela regra da plataforma; datas dependem da base
    expect(mB.ORG_DEFAULTS_APPLIED).toBeGreaterThanOrEqual(4);
    expect(visB.length).toBeLessThanOrEqual(10);
    for (const f of visB) expect(["CERTAME_CONFIG", "CERTAME_SCHEDULE", "CONDITIONAL"], f.field.name).toContain(f.field.authority);
  }, 240_000);
});
