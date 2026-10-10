/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ZERO_REENTRY — preparação do Edital orientada por exceções, MySQL REAL, dados SINTÉTICOS, pelas MESMAS rotas e pela MESMA lógica de
 * plano/execução do cliente (`buildSavePlan` + `executeSavePlan`), sem `seedGoverned`.
 *
 *  Z1  perfil do órgão configurado UMA vez → processo A (só decisões do certame) → preflight READY → M1 → emissão (M2);
 *      processo B do mesmo órgão: zero reentrada institucional; mudar o perfil: processo novo vê a nova revisão, A não é reescrito
 *  Z2  projeções determinísticas (objeto, UF por extenso, TR oficial estruturado): somente leitura, com origem; TR sem dado estruturado ⇒ pendência
 *  Z3  condicionais: ocultas até a decisão que as ativa; pós-homologação nunca aparece; métricas de produtividade (relatório)
 *  Z4  várias escritas SEQUENCIAIS com CAS encadeado: conflito no meio ⇒ para, informa o registrado, não sobrescreve; replay idempotente
 *  Z5  isolamento de tenant do perfil do órgão; preflight com resumo de decisões pendentes e zero escrita
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
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateCompositionPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { recordHumanDecision } from "../../services/institutionalTemplates/decisionRecorder";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord } from "../../services/institutionalTemplates/governedFieldsStore";
import { GOVERNED_FIELDS_SCHEMA, encodeGovernedPayload } from "../../domain/institutionalTemplates/governedSources";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import { completeProfile, fillTrParams, profileAsPrepView, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, orgProfilePending, toFormValue,
  type PlannedWrite, type PreparationStateView, type SectionEdits,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, E2E_SCENARIO, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, governedFieldsFor, seedExtraProcess, seedOfficialTr, seedWorld, syntheticCnpj, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 984_000_000 + STAMP * 10;
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
const writes = async (p: P) => ({
  drafts: await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]),
  m1: await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [p.org]),
  official: await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital'", [p.org]),
});
const decisionsOf = (org: number, type: string) => count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = ?", [org, type]);

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

const valueCache = new Map<string, Record<string, unknown>>();
const scenarioValue = (source: string, path: string): unknown => {
  if (!valueCache.has(source)) valueCache.set(source, governedFieldsFor(source as any, E2E_SCENARIO));
  return valueCache.get(source)![path];
};

const harnessOf = (p: P): ReuseHarness => ({ org: p.org, proc: () => proc(p.org), tpl: () => tpl(p.org), ws: WS, processId: p.w.processId, key });

/** Repete o ciclo da tela até não haver pendência: pega SÓ as pendências (ao vivo), digita o valor e salva com UMA confirmação. */
async function fillPending(p: P, opts: { scope?: "ORG" | "PROCESS" | "ALL"; skipTr?: string[] } = {}): Promise<{ rounds: number; typed: string[] }> {
  const scope = opts.scope ?? "PROCESS";
  const typed: string[] = [];
  // CONTEXT_REUSE 2.0: o Perfil de Licitações (órgão) e os Parâmetros estruturados do TR têm entrada PRÓPRIA (não a preparação do Edital).
  if (scope === "ORG" || scope === "ALL") { const r = await completeProfile(harnessOf(p)); for (let i = 0; i < r.policiesTyped + r.rolesRegistered; i++) typed.push("perfil"); }
  if (scope === "PROCESS" || scope === "ALL") { await fillTrParams(harnessOf(p), {}, opts.skipTr); await stampTrLineage(conn, harnessOf(p), p.tr.documentId); }   // TR emitido com este snapshot
  if (scope === "ORG") return { rounds: 0, typed };
  // PR #288: divulgação do orçamento (Pesquisa de Preços) e regime de participação (Itens) têm ORIGEM própria; o Edital não os pede.
  { const st0 = await getState(p); if (!st0.budgetDisclosure) await setBudgetDisclosure(harnessOf(p)); if (st0.participationPending) await setItemsParticipation(harnessOf(p)); }
  for (let round = 1; round <= 8; round++) {
    const st = await getState(p);
    const pend = livePendingItems(st, {}).filter((i) => scope === "ALL" || i.section.scope === scope);
    if (pend.length === 0) return { rounds: round - 1, typed };
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of pend) {
      const v = scenarioValue(field.source, field.path);
      expect(v, `valor de cenário para ${field.name}`).not.toBeUndefined();
      (edits[section.source] ??= {})[field.path] = toFormValue(field, v);   // ida e volta: o que a pessoa "digitaria"
      typed.push(field.name);
    }
    const plan = buildSavePlan(st, { edits: edits as Record<string, SectionEdits> });
    expect(plan.errors).toEqual({});
    expect(plan.writes.length).toBeGreaterThan(0);
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st), stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
  }
  throw new Error("preparação não convergiu");
}

const gen = (p: P) => proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("gen") } as any) as Promise<any>;

describe.skipIf(!DB)("Preparação do Edital — ZERO_REENTRY (MySQL real, rotas e plano do cliente, SEM seedGoverned)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "zero-reentry-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  it("Z1 — perfil do órgão UMA vez; processo A só com decisões do certame; processo B zero reentrada; mudar o perfil não reescreve o emitido", async () => {
    const a = await prepareOrg("z1");
    // 0. órgão sem perfil: o bloco "Configuração institucional pendente" existe
    const s0 = await getState(a);
    expect(orgProfilePending(s0).length).toBeGreaterThan(0);
    expect(s0.orgProfile).toBeNull();

    // 1. perfil institucional registrado UMA vez (somente pendências do escopo ORG)
    const orgFill = await fillPending(a, { scope: "ORG" });
    expect(orgFill.typed.length).toBeGreaterThan(10);
    const s1 = await getState(a);
    expect(orgProfilePending(s1)).toEqual([]);
    const orgRevision = s1.revisions.organization;
    expect(s1.orgProfile?.revision).toBe(orgRevision);
    const orgDecisionsAfterProfile = await decisionsOf(a.org, "institutional.policy");

    // 2. processo A: o que sobra é decisão do PROCESSO (nada institucional, nada canônico, nada condicional inativo)
    const visible = livePendingItems(s1, {});
    expect(visible.length).toBeGreaterThan(0);
    for (const { field } of visible) {
      // Projeção sem dado estruturado (ex.: unidade requisitante não informada) vira pendência humana EXPLÍCITA (regra PROJECTION).
      if (field.class === "CANONICAL") expect(field.rule, field.name).toBe("PROJECTION");
      else expect(["PROCESS_DECISION", "TR_PROJECTION", "CONDITIONAL"], field.name).toContain(field.class);
      expect(field.status).toBe("PENDING");
    }
    expect(visible.some((i) => i.section.scope === "ORG")).toBe(false);
    expect(s1.metrics.ORG_REUSED).toBeGreaterThan(10);
    const processFill = await fillPending(a, { scope: "PROCESS" });
    expect(processFill.typed.length).toBeLessThan(s1.metrics.TOTAL_TEMPLATE_FIELDS / 2);
    expect(await decisionsOf(a.org, "institutional.policy")).toBe(orgDecisionsAfterProfile);   // processo A não tocou no perfil

    // 3. preflight READY → gerar M1 → revisão humana → emissão
    const zero = await writes(a);
    const pf = await preflight(a);
    expect(pf.status).toBe("READY_FOR_COMPOSITION");
    expect(pf.pendingDecisions).toBe(0);
    expect(await writes(a)).toEqual(zero);
    const ra = await gen(a);
    expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const draftA = (await rows("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [a.org, a.w.processId]))[0];
    expect(draftA.content).toContain("Paraná");                  // UF por extenso projetada do cadastro do órgão
    const reviewA: any = await proc(a.org).editalTemplateReviewState({ processId: a.w.processId });
    const human = draftA.content.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe.");
    await proc(a.org, "operator", U_EDITOR).saveReviewableDraft({ processId: a.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draftA.content), idempotencyKey: key("edit") });
    const rs: any = await proc(a.org).editalTemplateReviewState({ processId: a.w.processId });
    for (const d of rs.structuralDeviations) {
      await tpl(a.org, "operator", U_MANAGER).reviews.acknowledgeDeviation({ manifestId: rs.generationManifestId, blockId: d.blockId, kind: d.kind, confirm: true, idempotencyKey: key("ack"), decision: decision({ basisReference: "Revisão" }) });
    }
    expect(reviewA.generationManifestId).toBe(ra.generationManifestId);
    const promoted: any = await proc(a.org, "manager", U_MANAGER).promoteOfficial({ processId: a.w.processId, kind: "edital", idempotencyKey: key("promo"), expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor." } as any);
    expect(promoted.promoted).toBe(true);
    const officialA = (await rows("SELECT id, content, content_hash h FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [a.org]))[0];
    const m1A = (await rows("SELECT manifest_hash h FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [a.org]))[0].h;

    // 4. processo B do MESMO órgão: zero reentrada institucional
    const b = await addProcess(a, "z1b", 1);
    const sb = await getState(b);
    expect(orgProfilePending(sb)).toEqual([]);
    expect(sb.orgProfile?.revision).toBe(orgRevision);
    expect(sb.metrics.ORG_REUSED).toBe(s1.metrics.ORG_REUSED);
    expect(sb.sections.filter((s) => s.scope === "ORG").every((s) => s.fields.every((f) => f.status !== "PENDING"))).toBe(true);
    const reusedField = sb.sections.find((s) => s.source === "POLICY")!.fields.find((f) => f.status === "ORG_REUSED")!;
    expect(reusedField.origin?.label).toBe("Perfil institucional do órgão");
    expect(reusedField.origin?.ref?.revision).toBe(orgRevision);
    await fillPending(b, { scope: "PROCESS" });
    expect(await decisionsOf(a.org, "institutional.policy")).toBe(orgDecisionsAfterProfile);   // B não gravou nada institucional
    expect((await preflight(b)).status).toBe("READY_FOR_COMPOSITION");
    const rbm1 = await gen(b);
    expect(rbm1.generationMode).toBe("INSTITUTIONAL_TEMPLATE");

    // 5. mudar o perfil institucional (nova revisão): processo NOVO vê a nova revisão; A (emitido) não é reescrito
    const sBefore = profileAsPrepView(await proc(b.org).licitacoesProfile({ processId: b.w.processId, ...WS }));
    const policy = sBefore.sections.find((s) => s.source === "POLICY")!;
    const field = policy.fields.find((f) => f.name === "sancoes.multaMoraPercentual")!;
    const planChange = buildSavePlan(sBefore, { edits: { POLICY: { [field.path]: "0,7" } } });
    expect(planChange.writes.map((w) => w.id)).toEqual(["ORG-POLICY"]);
    const changed = await executeSavePlan(planChange.writes, sBefore.revisions, writerFor(b, await getState(b)), stale);
    expect(changed.failed).toBeNull();
    const c = await addProcess(a, "z1c", 2);
    const sc = await getState(c);
    expect(sc.orgProfile?.revision).toBe(orgRevision + 1);
    expect(sc.sections.find((s) => s.source === "POLICY")!.fields.find((f) => f.name === field.name)!.displayValue).toBe(0.7);
    expect(orgProfilePending(sc)).toEqual([]);
    // lineage: nada do emitido/M1 de A mudou
    const officialA2 = (await rows("SELECT id, content, content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [a.org, officialA.id]))[0];
    expect(officialA2.content).toBe(officialA.content);
    expect(officialA2.h).toBe(officialA.h);
    expect((await rows("SELECT manifest_hash h FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION' AND id = ?", [a.org, ra.generationManifestId]))[0].h).toBe(m1A);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [a.org])).toBe(1);
    // o M1 de B (gerado antes da mudança) fica desatualizado ⇒ a emissão de B seria bloqueada por SOURCE_CHANGED (fail-closed)
    const rsB: any = await proc(a.org).editalTemplateReviewState({ processId: b.w.processId });
    expect(rsB.revalidation.status).toBe("BLOCKED");
    expect(JSON.stringify(rsB.revalidation.issues)).toContain("SOURCE_CHANGED");
    expect(legacy.calls).toBe(0);
  }, 900_000);

  it("Z2 — projeções determinísticas somente leitura, com origem; TR sem dado estruturado ⇒ pendência humana explícita", async () => {
    const p = await prepareOrg("z2");
    const st = await getState(p);
    const canon = (n: string) => st.canonicalFields.find((f) => f.name === n);
    expect(canon("processo.numeroProcesso")).toMatchObject({ status: "AUTO", origin: { label: "Processo" } });
    expect(canon("instituicao.municipioNome")).toMatchObject({ status: "AUTO", displayValue: "Moreira Sales", origin: { label: "Cadastro do órgão" } });
    expect(canon("instituicao.municipioCnpj")?.displayValue).toBe(syntheticCnpj(p.org));
    expect(canon("processo.quadroItensContratacao")).toMatchObject({ status: "AUTO", origin: { label: "Itens da contratação" } });
    const field = (n: string) => st.sections.flatMap((s) => s.fields).find((f) => f.name === n)!;
    expect(field("processo.objetoResumido")).toMatchObject({ status: "AUTO", editable: false, displayValue: "Aquisição sintética de material de expediente", origin: { label: "Processo" } });
    expect(field("instituicao.municipioUfExtenso")).toMatchObject({ status: "AUTO", editable: false, displayValue: "Paraná", origin: { label: "Cadastro do órgão" } });
    expect(field("instituicao.municipioSede")).toMatchObject({ status: "AUTO", displayValue: "Moreira Sales" });
    const objTr = field("processo.objetoCompleto");
    expect(objTr).toMatchObject({ class: "TR_PROJECTION", status: "AUTO", editable: false, displayValue: TR_META.object, origin: { label: "TR oficial" } });
    expect(objTr.origin?.ref).toMatchObject({ documentId: p.tr.documentId, version: 1, contentHash: p.tr.contentHash });
    expect(st.metrics.TR_PROJECTED).toBe(1);
    // nenhuma projeção aparece como pendência nem como input
    expect(livePendingItems(st, {}).some((i) => ["processo.objetoResumido", "processo.objetoCompleto", "instituicao.municipioUfExtenso", "instituicao.municipioSede"].includes(i.field.name))).toBe(false);
    // TR sem dado estruturado (emitido sem objeto no metadata) ⇒ pendência humana EXPLÍCITA, nunca texto livre parseado
    const q = await addProcess(p, "z2q", 1, null);
    const sq = await getState(q);
    expect(sq.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")).toMatchObject({ class: "TR_PROJECTION", status: "PENDING_TR", editable: false });
    expect(sq.metrics.TR_PROJECTED).toBe(0);
    // pós-homologação nunca aparece
    expect(st.sections.flatMap((s) => s.fields).some((f) => f.name.startsWith("pos."))).toBe(false);
    expect(st.metrics.POST_AWARD_HIDDEN).toBe(20);
  }, 600_000);

  it("Z3 — condicionais ocultas até a decisão que as ativa; métricas de produtividade (relatório)", async () => {
    const p = await prepareOrg("z3");
    const sNoProfile = await getState(p);
    const pendingNoProfile = livePendingItems(sNoProfile, {}).length;
    await fillPending(p, { scope: "ORG" });
    const s0 = await getState(p);
    const all = s0.sections.flatMap((s) => s.fields);
    const get = (st: PreparationStateView, n: string) => st.sections.flatMap((s) => s.fields).find((f) => f.name === n)!;
    // SRP: o controle é obrigatório e está pendente; os filhos estão ocultos
    expect(get(s0, "controle.utilizaSrp")).toMatchObject({ status: "PENDING", class: "PROCESS_DECISION" });
    expect(get(s0, "srp.orgaoGerenciadorSrp").status).toBe("HIDDEN_CONDITIONAL");
    expect(get(s0, "srp.prazoVigenciaAta").status).toBe("HIDDEN_CONDITIONAL");
    expect(livePendingItems(s0, {}).some((i) => i.field.name.startsWith("srp."))).toBe(false);
    // AO VIVO (sem salvar): decidir "usa SRP" revela só os novos campos; decidir "não" mantém tudo oculto
    const on = livePendingItems(s0, { PROCESS: { utilizaSrp: "true" } }).map((i) => i.field.name);
    expect(on).toEqual(expect.arrayContaining(["srp.orgaoGerenciadorSrp", "srp.prazoVigenciaAta"]));
    expect(livePendingItems(s0, { PROCESS: { utilizaSrp: "false" } }).some((i) => i.field.name.startsWith("srp."))).toBe(false);
    // registrada a decisão, o servidor confirma (mesma avaliação que o composer fará)
    const out = await executeSavePlan(buildSavePlan(s0, { edits: { PROCESS: { utilizaSrp: "true" } } }).writes, s0.revisions, writerFor(p, s0), stale);
    expect(out.failed).toBeNull();
    const s1 = await getState(p);
    expect(get(s1, "srp.orgaoGerenciadorSrp")).toMatchObject({ status: "PENDING", class: "CONDITIONAL" });
    // métricas do cenário "órgão configurado + processo novo com itens/orçamento/TR": o que sobra para a pessoa
    const m = s1.metrics;
    const total = m.TOTAL_TEMPLATE_FIELDS;
    const report = {
      TOTAL_TEMPLATE_FIELDS: total, AUTO_RESOLVED: m.AUTO_RESOLVED, ORG_REUSED: m.ORG_REUSED, TR_PROJECTED: m.TR_PROJECTED, CONDITIONAL_HIDDEN: m.CONDITIONAL_HIDDEN,
      POST_AWARD_HIDDEN: m.POST_AWARD_HIDDEN, OPTIONAL_HIDDEN: m.OPTIONAL_HIDDEN, MANUAL_DECISIONS_VISIBLE: m.MANUAL_DECISIONS_VISIBLE,
      VISIBLE_PERCENT: Number(((m.MANUAL_DECISIONS_VISIBLE / total) * 100).toFixed(1)), BY_CLASS: m.BY_CLASS,
      // Linha de base da UI anterior: TODOS os campos governáveis (exceto autoridade canônica "dona" e pós-homologação) eram listados.
      PREVIOUS_UI_FIELDS: total - m.POST_AWARD_HIDDEN - s0.canonicalFields.length,
      PENDING_NEW_ORG_NO_PROFILE: pendingNoProfile,
      REDUCTION_PERCENT: Number(((1 - m.MANUAL_DECISIONS_VISIBLE / (total - m.POST_AWARD_HIDDEN - s0.canonicalFields.length)) * 100).toFixed(1)),
    };
    // eslint-disable-next-line no-console
    console.log("[METRICAS ZERO_REENTRY]", JSON.stringify(report));
    // o total classificado fecha com o catálogo; tudo que não é decisão visível está resolvido/oculto/opcional
    expect(m.AUTO_RESOLVED + m.TR_PROJECTED + m.ORG_REUSED + m.DECIDED + m.CONDITIONAL_HIDDEN + m.POST_AWARD_HIDDEN + m.OPTIONAL_HIDDEN + m.MANUAL_DECISIONS_VISIBLE).toBeGreaterThan(0);
    expect(m.MANUAL_DECISIONS_VISIBLE).toBeLessThan(total / 2);          // fração, não a maioria
    expect(m.AUTO_RESOLVED + m.ORG_REUSED + m.TR_PROJECTED).toBeGreaterThan(m.MANUAL_DECISIONS_VISIBLE / 2);
    expect(all.length + s0.canonicalFields.length + m.POST_AWARD_HIDDEN).toBe(total);   // nenhuma variável some do inventário
  }, 600_000);

  it("Z4 — escritas SEQUENCIAIS com CAS encadeado: conflito no meio para, informa o registrado e não sobrescreve; replay idempotente", async () => {
    const p = await prepareOrg("z4");
    await fillPending(p, { scope: "ORG" });
    const st = await getState(p);
    const pend = livePendingItems(st, {}).filter((i) => i.section.scope === "PROCESS");
    const bySource = (s: string) => pend.filter((i) => i.section.source === s);
    expect(bySource("PROCESS").length).toBeGreaterThan(0);
    expect(bySource("CERTAME_CONFIG").length).toBeGreaterThan(0);
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of [...bySource("PROCESS"), ...bySource("CERTAME_CONFIG")]) (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValue(field.source, field.path));
    await setBudgetDisclosure(harnessOf(p));
    const plan = buildSavePlan(st, { edits: edits as any });
    expect(plan.writes.map((w) => w.id)).toEqual(["PROCESS-PROCESS", "PROCESS-CERTAME_CONFIG"]);
    // outra pessoa grava no PROCESSO depois da escrita do TR (antes de CERTAME_CONFIG): o CAS do registro inteiro muda
    const sharedKeys = new Map<string, string>();
    let intruded = false;
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st, sharedKeys, async (w) => {
      if (w.id === "PROCESS-PROCESS" && !intruded) {
        intruded = true;
        const fresh = await getState(p);
        await tpl(p.org, "manager", 404).governed.recordProcessFields({
          confirm: true, idempotencyKey: key("intruder"), decision: decision(), expectedRevision: fresh.revisions.process, catalogVersion: fresh.catalogVersion,
          processId: p.w.processId, source: "NORMATIVE", fields: governedFieldsFor("NORMATIVE"),
        });
      }
    }), stale);
    expect(out.registered.map((w) => w.id)).toEqual(["PROCESS-PROCESS"]);
    expect(out.failed?.write.id).toBe("PROCESS-CERTAME_CONFIG");
    expect(out.failed?.stale).toBe(true);
    expect(out.notExecuted).toEqual([]);
    // nada foi sobrescrito: CERTAME_CONFIG segue vazio; TR e divulgação foram registrados; NORMATIVE do intruso preservado
    const after = await getState(p);
    expect(after.budgetDisclosure).toBe("publico");
    expect(after.sections.find((s) => s.source === "CERTAME_CONFIG")!.fields.some((f) => f.hasValue)).toBe(false);
    expect(after.sections.find((s) => s.source === "PROCESS")!.fields.some((f) => f.hasValue)).toBe(true);
    expect(after.sections.find((s) => s.source === "NORMATIVE")!.fields.some((f) => f.hasValue)).toBe(true);
    // recarregado: nova tentativa com a revisão fresca converge (a pessoa revisa e confirma de novo)
    const retry = buildSavePlan(after, { edits: { CERTAME_CONFIG: edits.CERTAME_CONFIG } as any });
    const retryKeys = new Map<string, string>();
    const ok = await executeSavePlan(retry.writes, after.revisions, writerFor(p, after, retryKeys), stale);
    expect(ok.failed).toBeNull();
    // replay (retry de rede): MESMA chave e mesmo payload ⇒ devolve a MESMA decisão, sem duplicar
    const last = retry.writes[retry.writes.length - 1];
    const before = await decisionsOf(p.org, "procurement.source_fields");
    const replay = await writerFor(p, after, retryKeys).write(last, after.revisions.process);
    expect(replay.revision).toBe(after.revisions.process + 1);
    expect(await decisionsOf(p.org, "procurement.source_fields")).toBe(before);
    // mesma chave com conteúdo DIFERENTE ⇒ recusa (nada gravado)
    const tampered = { ...last, fields: { ...(last.fields ?? {}), horarioAbertura: "07:00" } };
    await expect(writerFor(p, after, retryKeys).write(tampered, after.revisions.process)).rejects.toThrow(/DECISION_IDEMPOTENCY_CONFLICT/);
    expect(await decisionsOf(p.org, "procurement.source_fields")).toBe(before);
  }, 600_000);

  it("Z5 — isolamento de tenant do perfil; preflight com resumo de decisões pendentes e zero escrita", async () => {
    const a = await prepareOrg("z5a");
    const d = await prepareOrg("z5b");
    await fillPending(a, { scope: "ORG" });
    const sa = await getState(a);
    const sd = await getState(d);
    expect(orgProfilePending(sa)).toEqual([]);
    expect(sa.orgProfile?.revision).toBeGreaterThan(0);
    expect(orgProfilePending(sd).length).toBeGreaterThan(0);       // o perfil do órgão A NUNCA é reutilizado no órgão D
    expect(sd.orgProfile).toBeNull();
    expect(sd.metrics.ORG_REUSED).toBe(0);
    expect(JSON.stringify(sd)).not.toContain(String(a.org));
    // preflight: resumo humano + detalhes técnicos; zero escrita
    const zero = await writes(a);
    const pf = await preflight(a);
    expect(pf.status).toBe("BLOCKED");
    expect(pf.pendingDecisions).toBe(sa.summary.pendingDecisions);
    expect(pf.pendingDecisions).toBeGreaterThan(0);
    expect(pf.issues.some((i: any) => i.code === "GOVERNED_SOURCE_PENDING")).toBe(true);
    expect(await writes(a)).toEqual(zero);
    expect(legacy.calls).toBe(0);
  }, 600_000);

  /** Registra um valor LEGADO direto na camada de decisão (como existiria num ledger anterior à política canônica). */
  async function seedLegacy(p: P, scope: "PROCESS" | "ORG", sections: Record<string, Record<string, unknown>>) {
    const evidence = encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, { sections }).evidence;
    const cur = await readGovernedRecord(p.org, scope, scope === "ORG" ? GOVERNED_ORG_SUBJECT : p.w.processId, BLL.catalog);
    await recordHumanDecision(ctxOf(p.org), {
      subjectType: scope === "ORG" ? "institutional.policy" : "procurement.source_fields", decisionType: scope === "ORG" ? "institutional_policy" : "source_fields_declared",
      outcome: scope === "ORG" ? "estabelecida" : "declarado", mode: "revision", subjectId: scope === "ORG" ? GOVERNED_ORG_SUBJECT : p.w.processId, evidence,
      act: { confirm: true, idempotencyKey: key("legacy"), decision: decision() }, expectedRevision: cur?.revision ?? 0,
    });
  }
  const trDoc = async (p: P, version: number, object: string | null) =>
    seedOfficialTr(conn, p.w, version, `TERMO DE REFERÊNCIA — v${version}`, object ? { object } : undefined);
  const draftText = async (p: P) => (await rows("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]))[0]?.content as string | undefined;

  it("Z6 — TR EXATO: a projeção vem do documento do pin (nunca 'latest'); pin obsoleto ⇒ BLOCKED sem projetar a versão nova; nova versão entre preparação e geração ⇒ zero M1/draft", async () => {
    const org = newOrg();
    const w = await seedWorld(conn, org, "z6", { flagOn: true });
    const v1 = await trDoc({ org, w, tr: null as any, model: null }, 1, "Objeto v1");
    const p: P = { org, w, tr: v1, model: await publishBll(org) };
    await fillPending(p, { scope: "ALL", skipTr: ["processo.objetoCompleto"] });

    // T0: sem seleção do TR ⇒ "Selecione o TR oficial exato"; nada é projetado "do último"
    const s0 = await getState(p, false);
    expect(s0.trPin).toEqual({ state: "NOT_SELECTED" });
    const f0 = s0.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!;
    expect(f0).toMatchObject({ status: "AWAITING", editable: false });
    expect(f0.origin?.label).toContain("Selecione o TR oficial exato");
    expect(JSON.stringify(s0)).not.toContain("Objeto v1");

    // pin v1 vigente ⇒ projeção de v1, com a lineage do documento exato
    const s1 = await getState(p);
    expect(s1.trPin.state).toBe("VALID");
    const f1 = s1.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!;
    expect(f1).toMatchObject({ status: "AUTO", displayValue: "Objeto v1" });
    expect(f1.origin?.ref).toMatchObject({ documentId: v1.documentId, version: 1, contentHash: v1.contentHash });
    expect((await preflight(p)).status).toBe("READY_FOR_COMPOSITION");

    // T1: nasce v2 com outro objeto; quem enviou v1 NÃO recebe a projeção de v2 — fica BLOQUEADO (OFFICIAL_PIN_STALE)
    const v2 = await trDoc(p, 2, "Objeto v2");
    await stampTrLineage(conn, harnessOf(p), v2.documentId);   // v2 emitido com o mesmo snapshot dos parâmetros
    const stale = await getState(p);
    expect(stale.trPin).toMatchObject({ state: "INVALID", code: "OFFICIAL_PIN_STALE" });
    expect(stale.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")).toMatchObject({ status: "AWAITING", editable: false });
    expect(JSON.stringify(stale)).not.toContain("Objeto v2");
    const zero = await writes(p);
    const pfStale = await preflight(p);
    expect(pfStale.status).toBe("BLOCKED");
    expect(JSON.stringify(pfStale)).toContain("OFFICIAL_PIN_STALE");
    expect(JSON.stringify(pfStale)).not.toContain("Objeto v2");
    expect(await writes(p)).toEqual(zero);

    // T2: reseleção do pin vigente (v2) ⇒ projeção = Objeto v2, lineage de v2
    const p2: P = { ...p, tr: v2 };
    const s2 = await getState(p2);
    const f2 = s2.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!;
    expect(f2).toMatchObject({ status: "AUTO", displayValue: "Objeto v2" });
    expect(f2.origin?.ref).toMatchObject({ documentId: v2.documentId, version: 2, contentHash: v2.contentHash });
    expect(f2.origin?.ref?.documentId).not.toBe(v1.documentId);
    expect((await preflight(p2)).status).toBe("READY_FOR_COMPOSITION");

    // T3: entre a preparação (pin v2 válido) e a geração nasce v3 ⇒ pin v2 obsoleto, ZERO M1/draft, exige reseleção
    const v3 = await trDoc(p2, 3, "Objeto v3");
    await stampTrLineage(conn, harnessOf(p2), v3.documentId);
    const before = await writes(p2);
    const refused = await gen(p2).then(() => null, (e: any) => e);
    expect(refused?.message).toContain("OFFICIAL_PIN_STALE");
    expect(await writes(p2)).toEqual(before);
    expect(before).toMatchObject({ drafts: 0, m1: 0 });
    expect(legacy.calls).toBe(0);
  }, 600_000);

  it("Z7 — projeção do TR exato na composição: o documento do M1 usa o objeto do MESMO documento do pin (pin e projeção = mesma lineage)", async () => {
    const org = newOrg();
    const w = await seedWorld(conn, org, "z7", { flagOn: true });
    await trDoc({ org, w, tr: null as any, model: null }, 1, "Objeto v1 (antigo)");
    const v2 = await trDoc({ org, w, tr: null as any, model: null }, 2, "Objeto v2 (vigente, estruturado)");
    const p: P = { org, w, tr: v2, model: await publishBll(org) };
    await fillPending(p, { scope: "ALL", skipTr: ["processo.objetoCompleto"] });
    await gen(p);
    const text = (await draftText(p))!;
    expect(text).toContain("Objeto v2 (vigente, estruturado)");
    expect(text).not.toContain("Objeto v1 (antigo)");
    // as fontes do composer, resolvidas com o pin exato, entregam o objeto do MESMO documento
    const ports = getTemplateCompositionPorts();
    const official = await ports.canonical.pinOfficialDocuments(org, w.processId, ["TR"], { TR: v2 });
    expect(official.TR).toMatchObject({ documentId: v2.documentId, version: 2, contentHash: v2.contentHash });
    const src = await ports.canonical.resolveSources(org, w.processId, ["TR"], BLL.catalog, official);
    expect((src.TR?.data as any).objetoCompleto).toBe("Objeto v2 (vigente, estruturado)");
    // pin divergente do documento lido ⇒ falha fechada (nunca lê outro)
    await expect(ports.canonical.resolveSources(org, w.processId, ["TR"], BLL.catalog, { TR: { ...official.TR!, version: 1 } })).rejects.toThrow(/OFFICIAL_PIN_MISMATCH/);
    // sem pin ⇒ nenhuma projeção do TR (pendência humana explícita), nunca "o último"
    const none = await ports.canonical.resolveSources(org, w.processId, ["TR"], BLL.catalog);
    expect((none.TR?.data as any)?.objetoCompleto).toBeUndefined();
  }, 600_000);

  it("Z8 — CANONICAL é uma autoridade: valor LEGADO no ledger é ignorado (preparação e composição), preservado como história; novas gravações são recusadas", async () => {
    const p = await prepareOrg("z8");
    // ledger legado (anterior à política): objeto, unidade requisitante, localidade e UF "antigos"
    await seedLegacy(p, "PROCESS", { PROCESS: { objetoResumido: "OBJETO LEGADO", secretariaRequisitante: "SECRETARIA LEGADA" } });
    await seedLegacy(p, "ORG", { IDENTITY: { municipioSede: "CIDADE LEGADA", municipioUfExtenso: "ESTADO LEGADO" } });
    const legacyProcessRevision = (await getState(p)).revisions.process;
    const decisionsBefore = await decisionsOf(p.org, "procurement.source_fields");

    // C1/C3: a preparação mostra a autoridade canônica; o legado aparece só como aviso técnico
    const st = await getState(p);
    const fld = (n: string) => st.sections.flatMap((s) => s.fields).find((f) => f.name === n)!;
    expect(fld("processo.objetoResumido")).toMatchObject({ status: "AUTO", editable: false, displayValue: "Aquisição sintética de material de expediente", shadowedLegacy: true });
    expect(fld("processo.secretariaRequisitante")).toMatchObject({ status: "AUTO", editable: false, displayValue: "Secretaria Municipal de Administração", shadowedLegacy: true });
    expect(fld("instituicao.municipioSede")).toMatchObject({ status: "AUTO", displayValue: "Moreira Sales", shadowedLegacy: true });
    expect(fld("instituicao.municipioUfExtenso")).toMatchObject({ status: "AUTO", displayValue: "Paraná", shadowedLegacy: true });
    expect(st.metrics.LEGACY_SHADOWED).toBe(4);
    expect(JSON.stringify(st.facts)).not.toMatch(/LEGAD/);
    expect(livePendingItems(st, {}).some((i) => i.field.class === "CANONICAL")).toBe(false);

    // C2: tentativa NOVA de gravar caminho canônico ⇒ recusada, zero alteração (inclusive misturada com campo legítimo)
    const catalogVersion = st.catalogVersion;
    const base = { confirm: true as const, decision: decision(), catalogVersion, expectedRevision: st.revisions.process };
    const e1 = await tpl(p.org).governed.recordProcessFields({ ...base, idempotencyKey: key("c2a"), processId: p.w.processId, source: "PROCESS", fields: { objetoResumido: "NOVO" } }).then(() => null, (e: any) => e);
    expect(e1?.message).toContain("CANONICAL_AUTHORITY_OWNED");
    const e2 = await tpl(p.org).governed.recordProcessFields({ ...base, idempotencyKey: key("c2b"), processId: p.w.processId, source: "PROCESS", fields: { secretariaRequisitante: "NOVA", fiscalContrato: "Fiscal X" } }).then(() => null, (e: any) => e);
    expect(e2?.message).toContain("CANONICAL_AUTHORITY_OWNED");
    const e3 = await tpl(p.org).governed.recordOrganizationFields({ ...base, expectedRevision: st.revisions.organization, idempotencyKey: key("c2c"), source: "IDENTITY", fields: { municipioSede: "NOVA", municipioUfExtenso: "NOVO" } }).then(() => null, (e: any) => e);
    expect(e3?.message).toContain("CANONICAL_AUTHORITY_OWNED");
    expect(await decisionsOf(p.org, "procurement.source_fields")).toBe(decisionsBefore);
    expect((await getState(p)).revisions.process).toBe(legacyProcessRevision);

    // a tela segue o fluxo normal (a UI nunca reenvia o canônico); o legado é PRESERVADO no registro corrente
    await fillPending(p, { scope: "ALL" });
    const rec = await readGovernedRecord(p.org, "PROCESS", p.w.processId, BLL.catalog);
    expect((rec!.raw.sections as any).PROCESS.objetoResumido).toBe("OBJETO LEGADO");
    const orec = await readGovernedRecord(p.org, "ORG", GOVERNED_ORG_SUBJECT, BLL.catalog);
    expect((orec!.raw.sections as any).IDENTITY.municipioSede).toBe("CIDADE LEGADA");
    expect(await decisionsOf(p.org, "procurement.source_fields")).toBeGreaterThan(decisionsBefore);   // histórico só cresce

    // composição: valor canônico; o legado NÃO aparece no documento
    await gen(p);
    const text = (await draftText(p))!;
    expect(text).toContain("Moreira Sales");
    expect(text).toContain("Paraná");
    expect(text).toContain("Secretaria Municipal de Administração");
    expect(text).not.toMatch(/OBJETO LEGADO|SECRETARIA LEGADA|CIDADE LEGADA|ESTADO LEGADO/);
  }, 600_000);

  it("Z9 — TR_PROJECTION: sem dado estruturado no TR exato a pessoa supre; quando o TR exato PASSA a trazer o dado, a projeção vence a decisão humana anterior", async () => {
    const org = newOrg();
    const w = await seedWorld(conn, org, "z9", { flagOn: true });
    const v1 = await trDoc({ org, w, tr: null as any, model: null }, 1, null);
    const p: P = { org, w, tr: v1, model: await publishBll(org) };
    await fillPending(p, { scope: "ORG" });
    const s0 = await getState(p);
    const obj0 = s0.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!;
    expect(obj0).toMatchObject({ class: "TR_PROJECTION", status: "PENDING_TR", editable: false });
    // a pessoa supre a ausência no fluxo do TR (Parâmetros estruturados) — NÃO na preparação do Edital
    const typed = (await fillPending(p, { scope: "PROCESS" })).typed;
    expect(typed.length).toBeGreaterThan(0);
    const s1 = await getState(p);
    expect(s1.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")).toMatchObject({ status: "UPSTREAM", editable: false });
    const supplied = String(s1.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!.displayValue);
    expect(supplied).toBeTruthy();

    // o TR passa a trazer o dado estruturado (nova versão emitida, novo pin): a projeção VENCE a decisão humana anterior
    const v2 = await trDoc(p, 2, "Objeto estruturado pelo TR v2");
    await stampTrLineage(conn, harnessOf(p), v2.documentId);
    const p2: P = { ...p, tr: v2 };
    const s2 = await getState(p2);
    const obj2 = s2.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")!;
    expect(obj2).toMatchObject({ status: "AUTO", editable: false, displayValue: "Objeto estruturado pelo TR v2" });
    const ports = getTemplateCompositionPorts();
    const official = await ports.canonical.pinOfficialDocuments(org, w.processId, ["TR"], { TR: v2 });
    const src = await ports.canonical.resolveSources(org, w.processId, ["TR"], BLL.catalog, official);
    expect((src.TR?.data as any).objetoCompleto).toBe("Objeto estruturado pelo TR v2");     // a decisão humana anterior não é usada
    expect(JSON.stringify(src.TR?.data)).not.toContain(supplied);
    // o fato confirmado no TR permanece no ledger como história (append-only)
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? AND path = 'tr.param.processo.objetoCompleto'", [org, w.processId])).toBe(1);
    expect((await preflight(p2)).status).toBe("READY_FOR_COMPOSITION");
  }, 600_000);
});
