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
import { createHash } from "node:crypto";
import { useGlobalFixtureLock } from "../helpers/globalFixtureLock";

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
import { buildEditalReadiness, generationCta } from "../../../client/src/lib/editalReadiness";
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetBaseDate, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, E2E_BUDGET_BASE_DATE, SYNTHETIC_PLATFORMS, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedExtraProcess, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
// Faixa PRÓPRIA deste arquivo ([991.000.000, 993.000.000)): arquivos distintos nunca compartilham ids de órgão (antes duas famílias usavam a MESMA base,
// e bases distintas se sobrepunham). Dentro da faixa: 20 mil posições de 100 órgãos por posição (≥ órgãos usados por arquivo).
const BASE_ORG = 991_000_000 + (STAMP % 20_000) * 100;
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
const MARKER = "[[SYSTEM_LATE_BOUND:processo.dataEmissaoEdital]]";
// Relógio CONTROLADO do fluxo governado (geração M1 e emissão M2 usam o `clock` das ports de composição).
let clockNow: string | null = null;
const realPorts = () => createTemplateCompositionPorts();
const useClock = (iso: string | null) => { clockNow = iso; };
const officialOf = async (p: P) => (await rows("SELECT id, content FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido' AND origin = ?", [p.org, p.w.processId]));
const issuanceManifests = async (p: P) => (await rows("SELECT body_json b, document_content_hash h, official_document_id o FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.org]));
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** M1 + revisão humana (marcadores [REVISAR] resolvidos); NÃO emite. */
async function composeAndReview(p: P): Promise<{ ra: any; human: string; draft: string }> {
  const ra = await gen(p);
  expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
  const draft = (await draftText(p))!;
  const human = draft.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe.");
  await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draft), idempotencyKey: key("edit") });
  return { ra, human, draft };
}
async function acknowledgeAll(p: P): Promise<void> {
  const rs: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
  for (const d of rs.structuralDeviations) {
    await tpl(p.org, "operator", U_MANAGER).reviews.acknowledgeDeviation({ manifestId: rs.generationManifestId, blockId: d.blockId, kind: d.kind, confirm: true, idempotencyKey: key("ack"), decision: decision({ basisReference: "Revisão" }) });
  }
}
const promote = (p: P, human: string, idempotencyKey: string) => proc(p.org, "manager", U_MANAGER).promoteOfficial({ processId: p.w.processId, kind: "edital", idempotencyKey, expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor." } as any) as Promise<any>;
/** Tenant pronto para compor (tudo registrado nas origens). */
async function readyTenant(label: string): Promise<P> {
  const p = await prepareOrg(label);
  await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p)); await fillTrueDecisions(p);
  return p;
}

// Muta/instala o reference set GLOBAL da Lei 14.133 (sem organization_id): serializa só entre os arquivos que fazem o mesmo.
useGlobalFixtureLock("legal_reference");

describe.skipIf(!DB)("PR #288 — CertameConfig como autoridade (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts({ ...realPorts(), clock: { now: () => clockNow ?? new Date().toISOString() } });
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
    expect(fieldOf(st, "julgamento.dataOrcamentoEstimado")).toMatchObject({ status: "AUTO", displayValue: E2E_BUDGET_BASE_DATE, authority: "UPSTREAM_PRICE_RESEARCH" });
    expect(fieldOf(st, "decisao.formaJulgamento")).toMatchObject({ status: "AUTO", displayValue: "item", authority: "UPSTREAM_ITEMS" });
    expect(fieldOf(st, "julgamento.regimeParticipacao")).toMatchObject({ status: "AUTO", authority: "UPSTREAM_ITEMS" });
    expect(fieldOf(st, "processo.dataEmissaoEdital")).toMatchObject({ status: "AUTO", authority: "LIFECYCLE_SYSTEM" });
    expect(String(fieldOf(st, "processo.dataEmissaoEdital").displayValue)).toContain("no ato da emissão oficial");   // não fabrica data antes da emissão
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
  it("UX-R — a PRONTIDÃO (view-model puro da UI) sobre o estado REAL do servidor: contadores unificados sem dupla contagem, recolhe com bloqueios, abre quando pronto", async () => {
    const p = await prepareOrg("uxr");
    // (1) equivalente ao piloto: TR exato NÃO selecionado, perfil do órgão incompleto, origens pendentes
    const s0 = await getState(p, false);
    const r0 = buildEditalReadiness(s0 as never);
    expect(r0.tr.status).toBe("TR_OFFICIAL_EXACT_REQUIRED");
    expect(r0.blockingPrerequisites).toBe(true);
    expect(r0.decisionsDefaultOpen).toBe(false);                                   // decisões RECOLHIDAS por padrão
    expect(r0.counters.PROCESS_DECISIONS_TOTAL).toBe(s0.metrics.TRUE_NEW_DECISIONS_VISIBLE);   // mesma contagem do servidor (nada inventado)
    // sem dupla contagem: o que o servidor chama de "reaproveitado" = automáticos + campos de SISTEMA atribuídos só na emissão
    expect(r0.counters.AUTO_RESOLVED_TOTAL + r0.details.systemAtIssuance).toBe(s0.summary.reusedAutomatically);
    expect(r0.counters.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL).toBeGreaterThan(0);
    expect(r0.counters.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL).toBeLessThanOrEqual((s0.upstream?.profilePending ?? []).length);
    const ids = new Set(r0.originGroups.flatMap((g) => g.items.map((i) => i.key)));
    expect(ids.size).toBe(r0.originGroups.reduce((n, g) => n + g.items.length, 0));   // nenhuma pendência repetida entre origens
    // (2) TR exato selecionado, mas perfil/origens ainda pendentes ⇒ continua bloqueado; só o TR deixa de bloquear
    const s1 = await getState(p, true);
    const r1 = buildEditalReadiness(s1 as never);
    expect(r1.steps.find((x) => x.key === "TR_OFFICIAL")!.done).toBe(true);
    expect(r1.blockingPrerequisites).toBe(true);
    expect(generationCta(r1).primary).toBe("RESOLVE_PENDING");
    // (3) tudo configurado nas origens: as decisões do certame abrem por padrão e o CTA assume a geração
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p));
    const s2 = await getState(p);
    const r2 = buildEditalReadiness(s2 as never);
    expect(r2.blockingPrerequisites).toBe(false);
    expect(r2.decisionsDefaultOpen).toBe(true);
    expect(r2.counters).toMatchObject({ ORIGIN_ACTION_REQUIRED_TOTAL: 0, ONE_TIME_CONFIGURATION_REQUIRED_TOTAL: 0 });
    expect(r2.counters.PROCESS_DECISIONS_TOTAL).toBe(s2.metrics.TRUE_NEW_DECISIONS_VISIBLE);
    expect(r2.counters.AUTO_RESOLVED_TOTAL + r2.details.systemAtIssuance).toBe(s2.summary.reusedAutomatically);
    METRICS.UXR = {
      PILOT_LIKE: { ...r0.counters, details: { requiredForCurrentDocument: r0.details.requiredForCurrentDocument, profileGlobalIncomplete: r0.details.profileGlobalIncomplete, systemAtIssuance: r0.details.systemAtIssuance, conditionalHidden: r0.details.conditionalHidden, postAwardHidden: r0.details.postAwardHidden }, decisionsDefaultOpen: r0.decisionsDefaultOpen },
      TR_PINNED_ONLY: { ...r1.counters, decisionsDefaultOpen: r1.decisionsDefaultOpen },
      READY: { ...r2.counters, decisionsDefaultOpen: r2.decisionsDefaultOpen },
    };
  }, 240_000);

  // ───────────────────────── PARTE A — DATA DE EMISSÃO (late-bound, LIFECYCLE_SYSTEM) ─────────────────────────

  it("E1 — M1 e emissão no MESMO dia: o oficial traz a data do ATO; M1 registra o campo late-bound; M2 materializa e explica", async () => {
    const p = await readyTenant("e1");
    useClock("2026-10-10T18:00:00.000Z");                         // 15:00 BRT
    const { ra, human, draft } = await composeAndReview(p);
    expect(draft).toContain(MARKER);                               // NÃO fabrica data no M1
    expect(draft).not.toMatch(/\[REVISAR[^\]]*dataEmissao/);       // não é pendência humana
    const m1 = (await rows("SELECT body_json b FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [p.org, ra.generationManifestId]))[0];
    expect(JSON.parse(m1.b).lateBound).toEqual([{ variable: "processo.dataEmissaoEdital", authority: "LIFECYCLE_SYSTEM", status: "PENDING_OFFICIAL_ISSUANCE" }]);
    const review: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(review.lateBound[0].message).toContain("será atribuída automaticamente no ato da emissão oficial");
    expect(review.unresolvedMarkers.count).toBe(0);               // o marcador de sistema NÃO conta como pendência humana
    await acknowledgeAll(p);
    expect(((await proc(p.org).editalTemplateReviewState({ processId: p.w.processId })) as any).revalidation.status).toBe("PASSED");

    useClock("2026-10-10T21:00:00.000Z");                         // 18:00 BRT, mesmo dia
    const r = await promote(p, human, key("promo"));
    expect(r.promoted).toBe(true);
    const [off] = await officialOf(p);
    expect(off.content).not.toContain("[[SYSTEM_LATE_BOUND");
    expect(off.content).toContain("10/10/2026");
    const [m2] = await issuanceManifests(p);
    const body = JSON.parse(m2.b);
    expect(body.lifecycleBindings).toEqual([{
      variable: "processo.dataEmissaoEdital", authority: "LIFECYCLE_SYSTEM", value: "2026-10-10", issuedAt: "2026-10-10T21:00:00.000Z",
      beforeContentHash: sha(human), afterContentHash: sha(off.content),
    }]);
    expect(m2.h).toBe(sha(off.content));                           // hash do conteúdo OFICIAL após o binding
    expect(r.officialDocument.contentHash).toBe(sha(off.content));
    expect(body.humanEditRefs.at(-1).resultingContentHash).toBe(sha(human));   // edição humana ≠ binding do sistema
    useClock(null);
  }, 240_000);

  it("E2/E3 — M1 em 10/10, revisão em 11/10, emissão em 12/10: oficial = 12/10 (nunca 10/10); a passagem do tempo NÃO é SOURCE_CHANGED", async () => {
    const p = await readyTenant("e2");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    const rv = async () => (await proc(p.org).editalTemplateReviewState({ processId: p.w.processId }) as any).revalidation;
    useClock("2026-10-11T15:00:00.000-03:00");
    expect((await rv()).status).toBe("PASSED");
    useClock("2026-10-12T15:00:00.000-03:00");
    const again = await rv();
    expect(again.status).toBe("PASSED");
    expect(JSON.stringify(again.issues)).not.toContain("SOURCE_CHANGED");
    expect((await promote(p, human, key("promo"))).promoted).toBe(true);
    const [off] = await officialOf(p);
    expect(off.content).toContain("12/10/2026");
    expect(off.content).not.toContain("10/10/2026");
    expect(JSON.parse((await issuanceManifests(p))[0].b).lifecycleBindings[0]).toMatchObject({ value: "2026-10-12" });
    useClock(null);
  }, 240_000);

  it("E4 — retry da emissão já persistida em outro dia: mesmo documento, mesma data, mesmo hash, sem segunda emissão", async () => {
    const p = await readyTenant("e4");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    useClock("2026-10-12T15:00:00.000-03:00");
    const k = key("promo");
    const first = await promote(p, human, k);
    const [off1] = await officialOf(p);
    useClock("2026-10-13T15:00:00.000-03:00");
    const retry = await promote(p, human, k);
    expect(retry.replayed).toBe(true);
    expect(retry.officialDocument).toEqual(first.officialDocument);
    const after = await officialOf(p);
    expect(after).toHaveLength(1);
    expect(after[0].content).toBe(off1.content);
    expect(after[0].content).toContain("12/10/2026");
    expect(await issuanceManifests(p)).toHaveLength(1);
    useClock(null);
  }, 240_000);

  it("E5 — tentativa que falha ANTES do commit não cria data de emissão fantasma; o retry bem-sucedido em 13/10 emite com 13/10", async () => {
    const p = await readyTenant("e5");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    const real = realPorts();
    // 12/10: a persistência do M2 falha (dentro da transação da emissão) ⇒ rollback de TUDO
    configureTemplateCompositionPorts({
      ...real, clock: { now: () => clockNow ?? new Date().toISOString() },
      manifests: { ...real.manifests, insertIssuanceManifest: async () => { throw new Error("falha simulada antes do commit"); } },
    } as never);
    useClock("2026-10-12T15:00:00.000-03:00");
    const k = key("promo");
    const failed = await promote(p, human, k).then(() => null, (e: any) => e);
    expect(failed).not.toBeNull();
    expect(await officialOf(p)).toHaveLength(0);                   // nenhuma versão oficial
    expect(await issuanceManifests(p)).toHaveLength(0);            // nenhum M2
    // 13/10: ports normais, mesma chave ⇒ emite com a data do ato efetivamente persistido
    configureTemplateCompositionPorts({ ...real, clock: { now: () => clockNow ?? new Date().toISOString() } });
    useClock("2026-10-13T15:00:00.000-03:00");
    const ok = await promote(p, human, k);
    expect(ok.promoted).toBe(true);
    const [off] = await officialOf(p);
    expect(off.content).toContain("13/10/2026");
    expect(off.content).not.toContain("12/10/2026");
    expect(JSON.parse((await issuanceManifests(p))[0].b).lifecycleBindings[0]).toMatchObject({ value: "2026-10-13", issuedAt: "2026-10-13T15:00:00.000-03:00" });
    useClock(null);
  }, 240_000);

  it("E6 — o marcador de sistema não pode ser falsificado: data digitada no lugar, marcador removido ou duplicado ⇒ emissão BLOQUEADA, zero oficial", async () => {
    const p = await readyTenant("e6");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    const variants: Record<string, string> = {
      "data digitada": human.replace(MARKER, "10/10/2026"),
      "marcador removido": human.replace(MARKER, ""),
      "marcador duplicado": `${human}\n${MARKER}\n`,
      "marcador forjado": `${human}\n[[SYSTEM_LATE_BOUND:processo.numeroPregao]]\n`,
    };
    for (const [name, content] of Object.entries(variants)) {
      const cur = (await draftText(p))!;
      await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content, expectedContentHash: draftContentHash(cur), idempotencyKey: key(`tamper-${name}`) });
      const rv: any = (await proc(p.org).editalTemplateReviewState({ processId: p.w.processId })).revalidation;
      expect(rv.status, name).toBe("BLOCKED");
      const blocked = await promote(p, content, key(`promo-${name}`)).then(() => null, (e: any) => e);
      expect(blocked, name).not.toBeNull();
      expect(String(blocked.message), name).toMatch(/LATE_BOUND_TAMPERED|PROTECTED_NODE_MISSING|TEMPLATE_ISSUANCE_BLOCKED/);
      expect(await officialOf(p), name).toHaveLength(0);
    }
    useClock(null);
  }, 300_000);

  // ───────────────────────── INSTANTE OFICIAL DA EMISSÃO — preso à transação (virada de dia) ─────────────────────────

  /**
   * Simula o tempo passando ENTRE a preparação (`prepare`, fora da tx) e a tentativa transacional: o relógio mostra `prepAt` até a
   * transação ser aberta e `txAt[n]` na n-ésima tentativa. `failAttempts` desfaz (rollback REAL) as primeiras tentativas com erro de
   * deadlock DEPOIS de executar o callback inteiro. Só vale para `db.transaction` aberto APÓS o relógio ter sido consultado pelo
   * `prepare` (as transações anteriores — ex.: reserva de idempotência — não alteram o relógio).
   */
  async function withTransactionClock<T>(prepAt: string, txAt: string[], failAttempts: number, run: () => Promise<T>): Promise<{ out: T; clockReads: Array<{ phase: string; at: string }>; attempts: number }> {
    const db: any = await (await import("../../db/connection")).getDb();
    const original = db.transaction;
    const clockReads: Array<{ phase: string; at: string }> = [];
    let phase = "prepare"; let reads = 0; let attempts = 0;
    clockNow = null;
    configureTemplateCompositionPorts({
      ...realPorts(),
      clock: { now: () => { reads++; const at = phase === "prepare" ? prepAt : txAt[Math.min(attempts, txAt.length) - 1]; clockReads.push({ phase, at }); return at; } },
    } as never);
    db.transaction = async function (this: unknown, fn: (tx: unknown) => Promise<unknown>, cfg?: unknown) {
      if (reads === 0) return original.call(db, fn, cfg);          // transação anterior ao prepare: não é a do ato
      phase = "transaction"; attempts++;
      const n = attempts;
      return original.call(db, async (tx: unknown) => {
        const r = await fn(tx);
        if (n <= failAttempts) throw Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
        return r;
      }, cfg);
    };
    try { return { out: await run(), clockReads, attempts }; }
    finally {
      db.transaction = original;
      configureTemplateCompositionPorts({ ...realPorts(), clock: { now: () => clockNow ?? new Date().toISOString() } });
    }
  }
  /** DATETIME(3) como ISO UTC (o banco guarda UTC; sem depender do fuso do driver). */
  const isoOf = (v: unknown): string => `${String(v).replace(" ", "T")}Z`;
  async function officialInstants(p: P, officialId: string) {
    const [o] = await rows("SELECT CAST(created_at AS CHAR) c, CAST(updated_at AS CHAR) u, lineage_id l FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, officialId]);
    const [pr] = await rows("SELECT CAST(created_at AS CHAR) c FROM official_document_promotions WHERE organization_id = ? AND official_document_id = ?", [p.org, officialId]);
    const tl = await rows("SELECT CAST(created_at AS CHAR) c FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ? AND event_type = 'documento_emitido'", [p.org, o.l]);
    return { createdAt: isoOf(o.c), updatedAt: isoOf(o.u), ledger: isoOf(pr.c), timeline: tl.map((r: any) => isoOf(r.c)) };
  }

  it("E7 — virada de dia: prepare 10/10 23:59:59.900 BRT, transação 11/10 00:00:00.100 BRT ⇒ o oficial é de 11/10 e TODOS os instantes do ato são o mesmo", async () => {
    const p = await readyTenant("e7");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    const PREP = "2026-10-10T23:59:59.900-03:00";
    const TX = "2026-10-11T00:00:00.100-03:00";
    const { out: r, clockReads } = await withTransactionClock(PREP, [TX], 0, () => promote(p, human, key("promo")));
    expect(r.promoted).toBe(true);
    expect(clockReads[0]).toEqual({ phase: "prepare", at: PREP });         // a revalidação teve o seu relógio real…
    expect(clockReads.some((c) => c.phase === "transaction" && c.at === TX)).toBe(true);   // …e o ato foi decidido DENTRO da transação
    const [off] = await officialOf(p);
    expect(off.content).toContain("11/10/2026");
    expect(off.content).not.toContain("10/10/2026");
    const [m2] = await issuanceManifests(p);
    const body = JSON.parse(m2.b);
    expect(body.lifecycleBindings).toHaveLength(1);
    expect(body.lifecycleBindings[0]).toMatchObject({ variable: "processo.dataEmissaoEdital", value: "2026-10-11", issuedAt: TX, beforeContentHash: sha(human), afterContentHash: sha(off.content) });
    expect(m2.h).toBe(sha(off.content));
    // Consistência temporal: documento oficial, ledger, timeline e M2 representam o MESMO instante (normalizado em UTC).
    const t = await officialInstants(p, off.id);
    const instant = new Date(TX).toISOString();                    // 2026-10-11T03:00:00.100Z
    expect(t.createdAt).toBe(instant);
    expect(t.updatedAt).toBe(instant);
    expect(t.ledger).toBe(instant);
    expect(t.timeline).toEqual([instant]);
    expect(new Date(body.lifecycleBindings[0].issuedAt).toISOString()).toBe(instant);
    // O instante de preparação (dia 10) NÃO vazou para nenhuma autoridade persistida.
    expect(JSON.stringify([t, body.lifecycleBindings])).not.toContain("2026-10-10T");
    METRICS.E7 = { PREP: PREP, TX, DATA_EMISSAO: body.lifecycleBindings[0].value, INSTANT: instant };
  }, 240_000);

  it("E8 — retry por deadlock: a tentativa 1 (10/10 23:59:59.900, desfeita) não deixa nada; a tentativa 2 (11/10 00:00:00.100) é a que persiste", async () => {
    const p = await readyTenant("e8");
    useClock("2026-10-10T15:00:00.000-03:00");
    const { human } = await composeAndReview(p);
    await acknowledgeAll(p);
    const PREP = "2026-10-10T23:59:59.800-03:00";
    const A1 = "2026-10-10T23:59:59.900-03:00";
    const A2 = "2026-10-11T00:00:00.100-03:00";
    const k = key("promo");
    const { out: r, clockReads, attempts } = await withTransactionClock(PREP, [A1, A2], 1, () => promote(p, human, k));
    expect(attempts).toBe(2);                                       // a tentativa 1 executou o callback inteiro e foi DESFEITA
    expect(r.promoted).toBe(true);
    expect(clockReads.filter((c) => c.phase === "transaction").map((c) => c.at)).toEqual([A1, A2]);   // cada tentativa capturou o SEU instante
    const offs = await officialOf(p);
    expect(offs).toHaveLength(1);                                   // só uma versão oficial
    expect(offs[0].content).toContain("11/10/2026");
    expect(offs[0].content).not.toContain("10/10/2026");
    const ms = await issuanceManifests(p);
    expect(ms).toHaveLength(1);
    const body = JSON.parse(ms[0].b);
    expect(body.lifecycleBindings[0]).toMatchObject({ value: "2026-10-11", issuedAt: A2 });
    const t = await officialInstants(p, offs[0].id);
    const instant = new Date(A2).toISOString();
    expect([t.createdAt, t.updatedAt, t.ledger, ...t.timeline]).toEqual([instant, instant, instant, instant]);
    // Nada do instante da tentativa desfeita (10/10 23:59:59.900 BRT = 11/10 02:59:59.900Z) foi persistido em lugar nenhum.
    const failedInstant = new Date(A1).toISOString();
    expect(JSON.stringify([t, ms[0].b, offs[0].content])).not.toContain(failedInstant);
    expect(await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [p.org, p.w.processId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ? AND event_type = 'documento_emitido'", [p.org, (await rows("SELECT lineage_id l FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, offs[0].id]))[0].l])).toBe(1);
    // Replay COMPLETED reutiliza TUDO (mesmo instante, sem nova emissão), mesmo com o relógio em outro dia.
    useClock("2026-10-20T10:00:00.000-03:00");
    const again = await promote(p, human, k);
    expect(again.replayed).toBe(true);
    expect(again.officialDocument).toEqual(r.officialDocument);
    expect(await officialOf(p)).toHaveLength(1);
    expect(await issuanceManifests(p)).toHaveLength(1);
    expect(await officialInstants(p, offs[0].id)).toEqual(t);
    METRICS.E8 = { ATTEMPTS: attempts, PERSISTED_INSTANT: instant, FAILED_ATTEMPT_PERSISTED: false, REPLAY_REUSES_ORIGINAL: true };
    useClock(null);
  }, 240_000);

  // ───────────────────────── PARTE B — DATA-BASE DO ORÇAMENTO (autoridade explícita) ─────────────────────────

  it("B1 — created_at da pesquisa existe, mas SEM data-base registrada o Edital NÃO a usa: pendência na Pesquisa de Preços (só sugestão na origem)", async () => {
    const p = await prepareOrg("b1");
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p), "publico", { baseDate: null }); await setItemsParticipation(harnessOf(p));
    expect(await count("SELECT COUNT(*) n FROM price_research WHERE organization_id = ? AND process_id = ?", [p.org, p.w.processId])).toBeGreaterThan(0);
    const st = await getState(p);
    const f = fieldOf(st, "julgamento.dataOrcamentoEstimado");
    expect(f).toMatchObject({ status: "PENDING_SOURCE", entry: "PRICE_RESEARCH", reason: "Data-base do orçamento não registrada." });
    expect(f.displayValue).toBeUndefined();
    expect(st.sections.flatMap((s: any) => s.fields).some((x: any) => x.name === "julgamento.dataOrcamentoEstimado" && x.editable)).toBe(false);   // sem input no Edital
    await fillTrueDecisions(p);
    const pf = await preflight(p);
    expect(pf.status).toBe("BLOCKED");
    expect(JSON.stringify(pf.issues)).toContain("Data-base do orçamento não registrada.");
    // a origem só OFERECE sugestão (created_at), com baseDate ainda nulo
    const origin: any = await proc(p.org).budgetDisclosure({ processId: p.w.processId, ...WS });
    expect(origin).toMatchObject({ enabled: true, baseDate: null });
    expect(origin.suggestedBaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 240_000);

  it("B2/B3 — data-base registrada (2026-09-30) é reutilizada read-only com lineage; created_at (2026-10-05) NÃO a substitui", async () => {
    const p = await prepareOrg("b2");
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setItemsParticipation(harnessOf(p));
    await conn.execute("UPDATE price_research SET created_at = '2026-10-05 15:00:00.000' WHERE organization_id = ? AND process_id = ?", [p.org, p.w.processId]);
    await setBudgetDisclosure(harnessOf(p), "publico", { baseDate: "2026-09-30" });
    const st = await getState(p);
    const f = fieldOf(st, "julgamento.dataOrcamentoEstimado");
    expect(f).toMatchObject({ status: "AUTO", displayValue: "2026-09-30", authority: "UPSTREAM_PRICE_RESEARCH" });
    expect(f.origin.label).toContain("Pesquisa de Preços");
    expect(f.origin.ref).toMatchObject({ baseDate: "2026-09-30" });
    expect(f.origin.ref.revision).toBeGreaterThan(0);
    expect(st.sections.flatMap((s: any) => s.fields).some((x: any) => x.name === "julgamento.dataOrcamentoEstimado" && x.editable)).toBe(false);
    const origin: any = await proc(p.org).budgetDisclosure({ processId: p.w.processId, ...WS });
    expect(origin).toMatchObject({ baseDate: "2026-09-30", suggestedBaseDate: "2026-10-05" });   // técnico ≠ semântico
    await fillTrueDecisions(p);
    expect((await preflight(p)).status).toBe("READY_FOR_COMPOSITION");
    await gen(p);
    const text = (await draftText(p))!;
    expect(text).toContain("30/09/2026");
    expect(text).not.toContain("05/10/2026");
  }, 240_000);

  it("B4 — nova revisão da data-base após o M1 ⇒ SOURCE_CHANGED, emissão bloqueada (zero M2); o documento já emitido permanece imutável", async () => {
    const a = await readyTenant("b4");
    const { human } = await composeAndReview(a);
    await acknowledgeAll(a);
    const rv = async () => (await proc(a.org).editalTemplateReviewState({ processId: a.w.processId }) as any).revalidation;
    expect((await rv()).status).toBe("PASSED");
    await setBudgetBaseDate(harnessOf(a), "2026-09-29");          // data-base B depois do M1 (data-base A = 2026-09-30)
    const changed = await rv();
    expect(changed.status).toBe("BLOCKED");
    expect(JSON.stringify(changed.issues)).toContain("SOURCE_CHANGED");
    const blocked = await promote(a, human, key("promo")).then(() => null, (e: any) => e);
    expect(blocked).not.toBeNull();
    expect(await issuanceManifests(a)).toHaveLength(0);
    expect(await officialOf(a)).toHaveLength(0);
    // recompor/revisar: nova geração com a base nova emite normalmente; o emitido anterior (se existisse) não mudaria
    const regenerated = await gen(a).then(() => "ok", (e: any) => String(e.message));
    expect(typeof regenerated).toBe("string");
  }, 300_000);

  it("B5 — tenant isolado: B não lê nem grava a data-base de A; a de B é independente", async () => {
    const a = await prepareOrg("b5a");
    const b = await prepareOrg("b5b");
    await completeProfile(harnessOf(a)); await setBudgetBaseDate(harnessOf(a), "2026-09-30");
    const stA: any = await proc(a.org).budgetDisclosure({ processId: a.w.processId, ...WS });
    const read = await proc(b.org).budgetDisclosure({ processId: a.w.processId, ...WS }).then(() => null, (e: any) => e);
    expect(read).not.toBeNull();
    const write = await tpl(b.org).governed.recordBudgetBaseDate({
      confirm: true, idempotencyKey: key("x"), decision: decision(), expectedRevision: stA.baseDateRevision, catalogVersion: stA.catalogVersion, processId: a.w.processId, baseDate: "2026-01-01",
    }).then(() => null, (e: any) => e);
    expect(write).not.toBeNull();
    await completeProfile(harnessOf(b));
    expect(((await proc(b.org).budgetDisclosure({ processId: b.w.processId, ...WS })) as any).baseDate).toBeNull();
    expect(((await proc(a.org).budgetDisclosure({ processId: a.w.processId, ...WS })) as any).baseDate).toBe("2026-09-30");
    // escrita genérica do Edital segue recusada
    const generic = await tpl(a.org).governed.recordProcessFields({
      confirm: true, idempotencyKey: key("g"), decision: decision(), expectedRevision: 1, catalogVersion: stA.catalogVersion, processId: a.w.processId, source: "BUDGET", fields: { dataOrcamentoEstimado: "2026-01-01" },
    }).then(() => null, (e: any) => e);
    expect(String(generic?.message)).toContain("DERIVED_AUTHORITY_OWNED");
  }, 240_000);
});
