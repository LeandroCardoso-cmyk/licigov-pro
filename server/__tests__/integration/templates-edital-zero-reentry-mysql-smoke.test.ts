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
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
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

const getState = async (p: P): Promise<PreparationStateView> => (await proc(p.org).editalTemplatePreparation({ processId: p.w.processId, ...WS })) as any;
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
      if (w.kind === "DISCLOSURE") r = await tpl(p.org).governed.recordBudgetDisclosure({ ...base, processId: p.w.processId, disclosure: w.disclosure! });
      else if (w.kind === "ORG") r = await tpl(p.org).governed.recordOrganizationFields({ ...base, catalogVersion: state.catalogVersion, source: w.source as any, fields: w.fields ?? {} });
      else r = await tpl(p.org).governed.recordProcessFields({ ...base, catalogVersion: state.catalogVersion, processId: p.w.processId, source: w.source as any, fields: w.fields ?? {}, ...(w.participation ? { participation: w.participation } : {}) });
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

/** Repete o ciclo da tela até não haver pendência: pega SÓ as pendências (ao vivo), digita o valor e salva com UMA confirmação. */
async function fillPending(p: P, opts: { scope?: "ORG" | "PROCESS" | "ALL" } = {}): Promise<{ rounds: number; typed: string[] }> {
  const scope = opts.scope ?? "PROCESS";
  const typed: string[] = [];
  for (let round = 1; round <= 8; round++) {
    const st = await getState(p);
    const pend = livePendingItems(st, {}).filter((i) => scope === "ALL" || i.section.scope === scope);
    const needDisclosure = scope !== "ORG" && !st.budgetDisclosure;
    const needParticipation = scope !== "ORG" && st.participationPending;
    if (pend.length === 0 && !needDisclosure && !needParticipation) return { rounds: round - 1, typed };
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of pend) {
      const v = scenarioValue(field.source, field.path);
      expect(v, `valor de cenário para ${field.name}`).not.toBeUndefined();
      (edits[section.source] ??= {})[field.path] = toFormValue(field, v);   // ida e volta: o que a pessoa "digitaria"
      typed.push(field.name);
    }
    const plan = buildSavePlan(st, { edits: edits as Record<string, SectionEdits>, disclosure: needDisclosure ? "publico" : "", participationDefault: needParticipation ? "Ampla participação, com os benefícios da LC nº 123/2006" : null });
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
    const reusedField = sb.sections.flatMap((s) => s.fields).find((f) => f.status === "ORG_REUSED")!;
    expect(reusedField.origin?.label).toBe("Perfil institucional do órgão");
    expect(reusedField.origin?.ref?.revision).toBe(orgRevision);
    await fillPending(b, { scope: "PROCESS" });
    expect(await decisionsOf(a.org, "institutional.policy")).toBe(orgDecisionsAfterProfile);   // B não gravou nada institucional
    expect((await preflight(b)).status).toBe("READY_FOR_COMPOSITION");
    const rbm1 = await gen(b);
    expect(rbm1.generationMode).toBe("INSTITUTIONAL_TEMPLATE");

    // 5. mudar o perfil institucional (nova revisão): processo NOVO vê a nova revisão; A (emitido) não é reescrito
    const sBefore = await getState(b);
    const policy = sBefore.sections.find((s) => s.source === "POLICY")!;
    const field = policy.fields.find((f) => f.name === "sancoes.multaMoraPercentual")!;
    const planChange = buildSavePlan(sBefore, { edits: { POLICY: { [field.path]: "0,7" } }, disclosure: "", participationDefault: null });
    expect(planChange.writes.map((w) => w.id)).toEqual(["ORG-POLICY"]);
    const changed = await executeSavePlan(planChange.writes, sBefore.revisions, writerFor(b, sBefore), stale);
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
    expect(sq.sections.flatMap((s) => s.fields).find((f) => f.name === "processo.objetoCompleto")).toMatchObject({ class: "TR_PROJECTION", status: "PENDING", editable: true });
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
    const out = await executeSavePlan(buildSavePlan(s0, { edits: { PROCESS: { utilizaSrp: "true" } }, disclosure: "", participationDefault: null }).writes, s0.revisions, writerFor(p, s0), stale);
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
    expect(bySource("TR").length).toBeGreaterThan(0);
    expect(bySource("CERTAME_CONFIG").length).toBeGreaterThan(0);
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of [...bySource("TR"), ...bySource("CERTAME_CONFIG")]) (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValue(field.source, field.path));
    const plan = buildSavePlan(st, { edits: edits as any, disclosure: "publico", participationDefault: null });
    expect(plan.writes.map((w) => w.id)).toEqual(["DISCLOSURE", "PROCESS-TR", "PROCESS-CERTAME_CONFIG"]);
    // outra pessoa grava no PROCESSO depois da escrita do TR (antes de CERTAME_CONFIG): o CAS do registro inteiro muda
    const sharedKeys = new Map<string, string>();
    let intruded = false;
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st, sharedKeys, async (w) => {
      if (w.id === "PROCESS-TR" && !intruded) {
        intruded = true;
        const fresh = await getState(p);
        await tpl(p.org, "manager", 404).governed.recordProcessFields({
          confirm: true, idempotencyKey: key("intruder"), decision: decision(), expectedRevision: fresh.revisions.process, catalogVersion: fresh.catalogVersion,
          processId: p.w.processId, source: "NORMATIVE", fields: governedFieldsFor("NORMATIVE"),
        });
      }
    }), stale);
    expect(out.registered.map((w) => w.id)).toEqual(["DISCLOSURE", "PROCESS-TR"]);
    expect(out.failed?.write.id).toBe("PROCESS-CERTAME_CONFIG");
    expect(out.failed?.stale).toBe(true);
    expect(out.notExecuted).toEqual([]);
    // nada foi sobrescrito: CERTAME_CONFIG segue vazio; TR e divulgação foram registrados; NORMATIVE do intruso preservado
    const after = await getState(p);
    expect(after.budgetDisclosure).toBe("publico");
    expect(after.sections.find((s) => s.source === "CERTAME_CONFIG")!.fields.some((f) => f.hasValue)).toBe(false);
    expect(after.sections.find((s) => s.source === "TR")!.fields.some((f) => f.hasValue)).toBe(true);
    expect(after.sections.find((s) => s.source === "NORMATIVE")!.fields.some((f) => f.hasValue)).toBe(true);
    // recarregado: nova tentativa com a revisão fresca converge (a pessoa revisa e confirma de novo)
    const retry = buildSavePlan(after, { edits: { CERTAME_CONFIG: edits.CERTAME_CONFIG } as any, disclosure: "", participationDefault: null });
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
});
