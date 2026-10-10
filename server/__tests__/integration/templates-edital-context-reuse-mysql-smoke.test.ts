/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CONTEXT_REUSE 2.0 — MySQL REAL, dados SINTÉTICOS, pelas MESMAS rotas e planos da tela (sem seedGoverned).
 *
 *  R1  principal: Tenant A configura o Perfil de Licitações UMA vez → Processo A (TR estruturado + TR oficial + Itens + Pesquisa) → Edital
 *      → preflight READY → M1 → revisão → M2; Processo B: zero reentrada institucional; mudar o ocupante de um papel → Processo C usa a
 *      nova revisão; Processo A emitido intacto; M1 de B vira SOURCE_CHANGED
 *  R2  métricas: FIRST_PROCESS_NEW_TENANT × SUBSEQUENT_PROCESS_CONFIGURED_TENANT (relatório honesto)
 *  R3  adversarial: tenant, processo, TR de outro processo, papel vencido, conflito canônico, padrão incompatível/inelegível, IA sem autoridade
 *  R4  mudança do TR estruturado e do DFD/contexto após o M1 ⇒ SOURCE_CHANGED; replay convergente com as mesmas autoridades
 * Só roda com DATABASE_URL. Nenhum dado real, nenhum processo 2026/253, nenhum modelo de produção.
 */
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
import { SYNTHETIC_ROLES, completeProfile, fillTrParams, scenarioValueByName, type ReuseHarness } from "../helpers/contextReuseHelpers";
import { recordContextAssertions } from "../../services/canonicalContextService";
import { generateDocument } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { renderTrStructuredBlock } from "../../services/institutionalTemplates/trStructuredParamsService";
import { factValueHash } from "../../domain/canonicalProcurementContext";
import { authorityEntryOf, isDefaultEligible } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, orgProfilePending, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedExtraProcess, seedOfficialTr, seedWorld, type World,
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
const writes = async (p: P) => ({
  drafts: await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]),
  m1: await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [p.org]),
  official: await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital'", [p.org]),
});

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


const harnessOf = (p: P): ReuseHarness => ({ org: p.org, proc: () => proc(p.org), tpl: () => tpl(p.org), ws: WS, processId: p.w.processId, key });
const profileState = async (p: P): Promise<any> => proc(p.org).licitacoesProfile({ processId: p.w.processId, ...WS });
const trState = async (p: P): Promise<any> => proc(p.org).trStructuredParams({ processId: p.w.processId, ...WS });
const visibleDecisions = async (p: P) => livePendingItems(await getState(p), {});
const gen = (p: P) => proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("gen") } as any) as Promise<any>;
const draftText = async (p: P) => (await rows("SELECT content FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]))[0]?.content as string | undefined;

/** Decisões genuínas do certame (preparação do Edital): digita SÓ o que a tela mostra como pendente, com o plano da tela. */
async function fillTrueDecisions(p: P): Promise<string[]> {
  const typed: string[] = [];
  for (let round = 1; round <= 8; round++) {
    const st = await getState(p);
    const pend = livePendingItems(st, {});
    const needDisclosure = !st.budgetDisclosure;
    const needParticipation = st.participationPending;
    if (pend.length === 0 && !needDisclosure && !needParticipation) return typed;
    const edits: Record<string, Record<string, any>> = {};
    for (const { section, field } of pend) { (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValueByName(field.name)); typed.push(field.name); }
    const plan = buildSavePlan(st, { edits: edits as any, disclosure: needDisclosure ? "publico" : "", participationDefault: needParticipation ? "Ampla participação, com os benefícios da LC nº 123/2006" : null });
    expect(plan.errors).toEqual({});
    const out = await executeSavePlan(plan.writes, st.revisions, writerFor(p, st), stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
  }
  throw new Error("decisões não convergiram");
}

/** "Usar como padrão institucional": ação EXPLÍCITA e confirmada, só para variáveis elegíveis, a partir do que a pessoa decidiu neste processo. */
async function useAsInstitutionalDefaults(p: P, names: string[]): Promise<void> {
  const st = await getState(p);
  const tr = await trState(p);
  const defaults: Record<string, unknown> = {};
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(st.facts, n)) defaults[n] = st.facts[n];
    else { const f = (tr.fields as any[]).find((x) => x.name === n); if (f?.status === "SET") defaults[n] = f.value; }
  }
  const prof = await profileState(p);
  const current = Object.fromEntries((prof.defaults as any[]).filter((d) => d.hasValue).map((d) => [d.name, d.value]));
  await tpl(p.org).governed.recordLicitacoesProfile({
    confirm: true, idempotencyKey: key("defaults"), decision: decision(), expectedRevision: prof.revision, catalogVersion: prof.catalogVersion, defaults: { ...current, ...defaults },
  });
}

/** Confirma, de uma vez, as PROPOSTAS de padrão institucional dos parâmetros do TR (ação humana explícita; proveniência `def`). */
async function confirmTrProposals(p: P): Promise<string[]> {
  const tr = await trState(p);
  const values: Record<string, unknown> = {};
  for (const f of tr.fields as any[]) if (f.proposal && f.status === "UNSET") values[f.name] = f.proposal.value;
  if (Object.keys(values).length === 0) return [];
  await proc(p.org).recordTrStructuredParams({ processId: p.w.processId, ...WS, values, fromDefaults: Object.keys(values) });
  return Object.keys(values);
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

describe.skipIf(!DB)("CONTEXT_REUSE 2.0 — Perfil de Licitações + TR estruturado + projeção upstream (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "context-reuse-synthetic" });
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
    console.log("[CONTEXT_REUSE METRICS]", JSON.stringify(METRICS));
  }, 120_000);

  it("R1 — perfil UMA vez; Processo A completo até M2; Processo B zero reentrada institucional; mudar o ocupante ⇒ Processo C usa a nova revisão; A intacto; M1 de B ⇒ SOURCE_CHANGED", async () => {
    const a = await prepareOrg("r1");
    // ── primeira utilização: perfil incompleto ⇒ UM card (não despeja campos) ──────────────────────────────────────────────
    const s0 = await getState(a);
    expect(orgProfilePending(s0).length).toBeGreaterThan(10);
    expect(s0.metrics.PROFILE_INCOMPLETE).toBe(orgProfilePending(s0).length);
    const prof0 = await profileState(a);
    expect(prof0.status).toBe("READY");
    expect(prof0.summary.pendingCount).toBeGreaterThan(0);
    expect(prof0.revision).toBe(0);

    // ── perfil configurado UMA vez (políticas + papéis) ────────────────────────────────────────────────────────────────────
    const prof = await completeProfile(harnessOf(a));
    expect(prof.rolesRegistered).toBe(8);
    const s1 = await getState(a);
    expect(orgProfilePending(s1)).toEqual([]);
    expect(s1.metrics.ORG_ROLES_REUSED).toBe(8);
    const roleField = s1.sections.flatMap((x) => x.fields).find((f) => f.name === "instituicao.pregoeiroNome")!;
    expect(roleField).toMatchObject({ status: "ORG_REUSED", editable: false, authority: "ORG_ROLE_PROFILE", displayValue: "Pregoeiro Sintético Costa" });
    expect(roleField.origin?.label).toContain("Pregoeiro");
    // Prefeito NÃO é presumido autoridade competente: papéis independentes
    expect(s1.sections.flatMap((x) => x.fields).find((f) => f.name === "instituicao.autoridadeCompetenteNome")!.displayValue).toBe("Autoridade Sintética Souza");

    // ── TR estruturado (Processo A) ────────────────────────────────────────────────────────────────────────────────────────
    const trBefore = await trState(a);
    expect(trBefore.status).toBe("READY");
    expect(trBefore.summary.pending).toBeGreaterThan(20);
    const trFill = await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);   // o TR oficial emitido traz o objeto estruturado
    const trAfter = await trState(a);
    expect(trAfter.summary.pending).toBe(1);   // só o objeto completo (vem do TR oficial exato)
    const prepNoTr = await getState(a);
    expect(prepNoTr.metrics.TR_PENDING).toBe(0);
    expect(prepNoTr.metrics.UPSTREAM_TR_REUSED).toBeGreaterThan(20);
    const tf = prepNoTr.sections.flatMap((x) => x.fields).find((f) => f.name === "contratacao.prazoExecucao")!;
    expect(tf).toMatchObject({ status: "UPSTREAM", editable: false, authority: "UPSTREAM_TR" });
    expect(tf.origin?.label).toBe("Parâmetros estruturados do TR");

    // ── decisões genuínas do certame ────────────────────────────────────────────────────────────────────────────────────────
    const firstVisible = (await visibleDecisions(a)).map((i) => i.field.name);
    expect(firstVisible.length).toBeGreaterThan(0);
    const typedA = await fillTrueDecisions(a);
    for (const n of firstVisible) expect(typedA, n).toContain(n);   // + condicionais ativadas em cascata pelas decisões
    for (const n of typedA) expect(["TRUE_PROCESS_DECISION", "CONDITIONAL"], n).toContain(authority(n));

    // ── preflight READY → M1 → revisão → M2 ──────────────────────────────────────────────────────────────────────────────────
    const pf = await preflight(a);
    expect(pf.status).toBe("READY_FOR_COMPOSITION");
    const issuedA = await reviewAndIssue(a);
    const text = (await draftText(a)) ?? "";
    expect(text.length).toBeGreaterThan(0);
    const officialA = (await rows("SELECT content, content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [a.org, issuedA.officialId]))[0];
    expect(officialA.content).toContain("Pregoeiro Sintético Costa");
    expect(officialA.content).toContain("Autoridade Sintética Souza");

    // ── "Usar como padrão institucional" (explícito, só elegíveis) ─────────────────────────────────────────────────────────────
    const eligiblePrep = typedA.filter((n) => isDefaultEligible(n));
    const eligibleTr = ["contratacao.formaPagamento", "contratacao.prazoPagamento", "contratacao.marcoInicialPagamento", "contratacao.indiceReajuste"];
    await useAsInstitutionalDefaults(a, [...eligiblePrep, ...eligibleTr]);
    const profD = await profileState(a);
    expect((profD.defaults as any[]).filter((d) => d.hasValue).map((d) => d.name).sort()).toEqual([...new Set([...eligiblePrep, ...eligibleTr])].sort());

    // ── Processo B do MESMO órgão: ZERO reentrada institucional ────────────────────────────────────────────────────────────
    const b = await addProcess(a, "r1b", 1);
    const sb = await getState(b);
    expect(orgProfilePending(sb)).toEqual([]);
    expect(sb.metrics.PROFILE_INCOMPLETE).toBe(0);
    expect(sb.metrics.ORG_ROLES_REUSED).toBe(8);
    expect(sb.metrics.ORG_DEFAULTS_APPLIED).toBe(eligiblePrep.length);
    const dflt = sb.sections.flatMap((x) => x.fields).find((f) => f.status === "ORG_DEFAULT")!;
    expect(dflt.origin?.label).toBe("Padrão institucional do órgão");
    expect(dflt.canOverrideDefault).toBe(true);
    // nada do processo A foi copiado: as decisões do certame de B são só as do certame (datas, SRP, critério…) — NÃO os valores de A
    const visB = await visibleDecisions(b);
    expect(visB.map((i) => i.field.name)).not.toEqual([]);
    for (const { field } of visB) expect(field.authority, field.name).toMatch(/TRUE_PROCESS_DECISION|CONDITIONAL/);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.source_fields' AND subject_id = ?", [b.org, b.w.processId])).toBe(0);
    // TR de B: propostas do padrão institucional; só valem após confirmação humana
    const trB0 = await trState(b);
    expect(trB0.summary.proposals).toBe(eligibleTr.length);
    expect((trB0.fields as any[]).filter((f) => f.status === "SET").length).toBe(0);
    const confirmed = await confirmTrProposals(b);
    expect(confirmed.sort()).toEqual([...eligibleTr].sort());
    const factB = (await rows("SELECT source_type st, source_id sid, source_version sv, status, actor_user_id a FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? AND path = 'tr.param.contratacao.formaPagamento'", [b.org, b.w.processId]))[0];
    expect(factB).toMatchObject({ st: "tr", sid: "tr-params", status: "confirmed" });
    expect(factB.sv).toMatch(/;def:\d+$/);       // proveniência: veio de PADRÃO institucional (revisão), confirmado por pessoa
    const trFillB = await fillTrParams(harnessOf(b), {}, ["processo.objetoCompleto"]);
    expect(trFillB.typed.length).toBeLessThan(trFill.typed.length);
    const typedB = await fillTrueDecisions(b);
    expect(typedB.length).toBeLessThan(typedA.length);
    expect((await preflight(b)).status).toBe("READY_FOR_COMPOSITION");
    const m1B = await gen(b);
    expect(m1B.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const orgDecisionsBefore = await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional.policy'", [a.org]);
    expect(orgDecisionsBefore).toBeGreaterThan(0);

    // ── mudar o OCUPANTE de um papel (nova revisão do perfil) ──────────────────────────────────────────────────────────────
    const profC = await profileState(a);
    const newRoles = { ...SYNTHETIC_ROLES, PREGOEIRO: { name: "Novo Pregoeiro Sintético Duarte", cargo: "Pregoeiro", ato: "Portaria sintética nº 99/2026", dataReferencia: "2026-03-01" } };
    await tpl(a.org).governed.recordLicitacoesProfile({ confirm: true, idempotencyKey: key("occupant"), decision: decision(), expectedRevision: profC.revision, catalogVersion: profC.catalogVersion, roles: newRoles });
    const profAfter = await profileState(a);
    expect(profAfter.revision).toBe(profC.revision + 1);                 // nova revisão, a anterior permanece no histórico
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional.policy'", [a.org])).toBe(orgDecisionsBefore + 1);
    const c = await addProcess(a, "r1c", 2);
    const sc = await getState(c);
    expect(sc.orgProfile?.revision).toBe(profAfter.revision);
    expect(sc.sections.flatMap((x) => x.fields).find((f) => f.name === "instituicao.pregoeiroNome")).toMatchObject({ status: "ORG_REUSED", displayValue: "Novo Pregoeiro Sintético Duarte" });
    expect(orgProfilePending(sc)).toEqual([]);
    // lineage: o emitido de A e o M1 de A permanecem intactos
    const officialA2 = (await rows("SELECT content, content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [a.org, issuedA.officialId]))[0];
    expect(officialA2).toEqual(officialA);
    expect(officialA2.content).toContain("Pregoeiro Sintético Costa");
    expect(officialA2.content).not.toContain("Novo Pregoeiro");
    // o M1 de B (gerado antes da mudança) fica desatualizado: SOURCE_CHANGED (fail-closed na emissão)
    const rsB: any = await proc(a.org).editalTemplateReviewState({ processId: b.w.processId });
    expect(rsB.revalidation.status).toBe("BLOCKED");
    expect(JSON.stringify(rsB.revalidation.issues)).toContain("SOURCE_CHANGED");
    expect(legacy.calls).toBe(0);

    METRICS.R1 = { firstVisible: firstVisible.length, trTypedFirst: trFill.typed.length, trTypedSubsequent: trFillB.typed.length, decisionsFirst: typedA.length, decisionsSubsequent: typedB.length };
  }, 900_000);
  it("R2 — métricas honestas: FIRST_PROCESS_NEW_TENANT × SUBSEQUENT_PROCESS_CONFIGURED_TENANT (cada campo restante é listado com o motivo)", async () => {
    const a = await prepareOrg("r2");
    // ── PRIMEIRO processo de um tenant NOVO ───────────────────────────────────────────────────────────────────────────────
    const s0 = await getState(a);
    const profilePending0 = orgProfilePending(s0).length;
    const trPending0 = (await trState(a)).summary.pending;
    const decisionsVisible0 = (await visibleDecisions(a)).length;
    const prof = await completeProfile(harnessOf(a));
    const trFill = await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);
    const decisions = await fillTrueDecisions(a);
    expect((await preflight(a)).status).toBe("READY_FOR_COMPOSITION");
    const eligible = decisions.filter((n) => isDefaultEligible(n));
    const eligibleTr = ["contratacao.formaPagamento", "contratacao.prazoPagamento", "contratacao.marcoInicialPagamento", "contratacao.marcoInicialRecebimentoProvisorio", "contratacao.prazoRecebimentoProvisorio", "contratacao.prazoRecebimentoDefinitivo", "contratacao.prazoSubstituicaoObjeto", "contratacao.indiceReajuste", "contratacao.marcoInicialExecucao"];
    await useAsInstitutionalDefaults(a, [...eligible, ...eligibleTr]);

    // ── processo SEGUINTE do tenant configurado ───────────────────────────────────────────────────────────────────────────
    const orgDecisionsBeforeB = await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional.policy'", [a.org]);
    const b = await addProcess(a, "r2b", 1);
    const sb = await getState(b);
    const trB0 = await trState(b);
    const visibleB = await visibleDecisions(b);
    const confirmed = await confirmTrProposals(b);
    const trFillB = await fillTrParams(harnessOf(b), {}, ["processo.objetoCompleto"]);
    const decisionsB = await fillTrueDecisions(b);
    expect((await preflight(b)).status).toBe("READY_FOR_COMPOSITION");

    // zero reentrada institucional no seguinte
    expect(orgProfilePending(sb)).toEqual([]);
    expect(sb.metrics.PROFILE_INCOMPLETE).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional.policy'", [b.org])).toBe(orgDecisionsBeforeB);   // B não gravou NADA institucional

    const reasonOf = (n: string) => authorityEntryOf(n)?.basis ?? "";
    const remaining = decisionsB.map((n) => ({ name: n, authority: authority(n), why: reasonOf(n) }));
    const REPORT = {
      FIRST_PROCESS_NEW_TENANT: {
        INSTITUTIONAL_PROFILE_FIELDS_PENDING: profilePending0, TR_PARAMS_PENDING: trPending0, TRUE_DECISIONS_VISIBLE_INITIAL: decisionsVisible0,
        MANUAL_FIELDS_TOTAL: prof.policiesTyped + prof.rolesRegistered + trFill.typed.length + decisions.length,
        profile: prof.policiesTyped + prof.rolesRegistered, trParams: trFill.typed.length, trueDecisions: decisions.length,
      },
      SUBSEQUENT_PROCESS_CONFIGURED_TENANT: {
        INSTITUTIONAL_PROFILE_REENTRY: orgProfilePending(sb).length,
        TRUE_DECISIONS_VISIBLE_INITIAL: visibleB.length, TRUE_DECISIONS_TYPED_TOTAL: decisionsB.length,
        TR_PROPOSALS_CONFIRMED_IN_ONE_ACTION: confirmed.length, TR_PARAMS_TYPED: trFillB.typed.length, TR_PARAMS_PENDING_INITIAL: trB0.summary.pending,
        MANUAL_FIELDS_TOTAL: trFillB.typed.length + decisionsB.length,
        ORG_DEFAULTS_APPLIED: sb.metrics.ORG_DEFAULTS_APPLIED, ORG_ROLES_REUSED: sb.metrics.ORG_ROLES_REUSED, ORG_POLICIES_REUSED: sb.metrics.ORG_POLICIES_REUSED,
        BY_AUTHORITY: sb.metrics.BY_AUTHORITY, REMAINING_TRUE_DECISIONS: remaining,
      },
    };
    METRICS.R2 = REPORT;
    // o seguinte exige MENOS que o primeiro (sem esconder informação: o que resta é decisão nova do certame)
    expect(REPORT.SUBSEQUENT_PROCESS_CONFIGURED_TENANT.MANUAL_FIELDS_TOTAL).toBeLessThan(REPORT.FIRST_PROCESS_NEW_TENANT.MANUAL_FIELDS_TOTAL);
    expect(REPORT.SUBSEQUENT_PROCESS_CONFIGURED_TENANT.TRUE_DECISIONS_TYPED_TOTAL).toBeLessThan(REPORT.FIRST_PROCESS_NEW_TENANT.trueDecisions);
    // nada oculto para bater meta: o inventário fecha (toda variável aparece em exatamente uma classe da matriz)
    const by = sb.metrics.BY_AUTHORITY as Record<string, number>;
    expect(Object.values(by).reduce((x, y) => x + y, 0)).toBe(sb.metrics.TOTAL_TEMPLATE_FIELDS);
    for (const r of remaining) expect(["TRUE_PROCESS_DECISION", "CONDITIONAL"], r.name).toContain(r.authority);
  }, 900_000);

  it("R3 — adversarial de tenant e de processo: perfil/TR/decisões de A nunca são lidos por B; TR de outro processo falha fechado", async () => {
    const a = await prepareOrg("r3a");
    const d = await prepareOrg("r3d");           // outro tenant
    await completeProfile(harnessOf(a));
    await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);
    await fillTrueDecisions(a);
    // tenant D não enxerga o perfil de A
    const profD = await profileState(d);
    expect(profD.revision).toBe(0);
    expect((profD.roles as any[]).filter((r) => r.assignment).length).toBe(0);
    expect(JSON.stringify(profD)).not.toContain("Pregoeiro Sintético Costa");
    const sd = await getState(d);
    expect(sd.metrics.ORG_ROLES_REUSED).toBe(0);
    expect(orgProfilePending(sd).length).toBeGreaterThan(10);
    // tenant D não lê nem grava TR/perfil por processo de A (anti-enumeração: NOT_FOUND)
    await expect(proc(d.org).trStructuredParams({ processId: a.w.processId, ...WS })).rejects.toThrow(/não encontrado/i);
    await expect(proc(d.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.prazoExecucao": { amount: 1, unit: "day" } } })).rejects.toThrow(/não encontrado/i);
    await expect(proc(d.org).licitacoesProfile({ processId: a.w.processId, ...WS })).rejects.toThrow(/não encontrado/i);
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND path LIKE 'tr.param.%'", [d.org])).toBe(0);
    // processo B do MESMO tenant: nenhuma decisão/parâmetro de A é herdado
    const b = await addProcess(a, "r3b", 1);
    const trB = await trState(b);
    expect((trB.fields as any[]).filter((f) => f.status === "SET").length).toBe(0);
    const sb = await getState(b);
    expect(sb.metrics.UPSTREAM_TR_REUSED).toBe(0);
    expect(sb.metrics.DECIDED).toBe(0);
    expect((await visibleDecisions(b)).length).toBeGreaterThan(10);   // nada de "último processo": decisões de A não valem para B
    // TR de OUTRO processo: o pin de A não vale para B (falha fechada, sem projetar)
    const wrong = await proc(b.org).editalTemplatePreparation({ processId: b.w.processId, ...WS, officialPins: pin(a.tr) }) as any;
    expect(wrong.trPin.state).toBe("INVALID");
    expect(JSON.stringify(wrong)).not.toContain(TR_META.object.slice(0, 20) + "XX");
    const pfWrong: any = await proc(b.org).editalTemplatePreflight({ processId: b.w.processId, ...WS, officialPins: pin(a.tr) });
    expect(pfWrong.status).toBe("BLOCKED");
    // parâmetro desconhecido/fora do TR e valor inválido são recusados; nada é gravado
    const before = await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND path LIKE 'tr.param.%'", [a.org]);
    await expect(proc(a.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.formaAssinaturaContrato": "x" } })).rejects.toThrow(/TR_PARAM_UNKNOWN/);
    await expect(proc(a.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.prazoExecucao": "três dias" } })).rejects.toThrow(/TR_PARAM_INVALID/);
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND path LIKE 'tr.param.%'", [a.org])).toBe(before);
    expect(legacy.calls).toBe(0);
  }, 900_000);

  it("R3b — papel VENCIDO não é usado em silêncio; padrão incompatível/inelegível não é aplicado; IA e outras fontes não afirmam parâmetros do TR", async () => {
    const a = await prepareOrg("r3e");
    await completeProfile(harnessOf(a));
    await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);
    await fillTrueDecisions(a);
    expect((await preflight(a)).status).toBe("READY_FOR_COMPOSITION");

    // papel vencido (vigência passada): o valor NÃO é usado; o perfil aparece incompleto com o motivo; preflight BLOQUEIA
    const prof = await profileState(a);
    await tpl(a.org).governed.recordLicitacoesProfile({
      confirm: true, idempotencyKey: key("stale"), decision: decision(), expectedRevision: prof.revision, catalogVersion: prof.catalogVersion,
      roles: { ...SYNTHETIC_ROLES, AUTORIDADE_COMPETENTE: { ...SYNTHETIC_ROLES.AUTORIDADE_COMPETENTE!, vigenciaAte: "2020-01-31" } },
    });
    const st = await getState(a);
    const f = st.sections.flatMap((x) => x.fields).find((x) => x.name === "instituicao.autoridadeCompetenteNome")!;
    expect(f).toMatchObject({ status: "PROFILE_INCOMPLETE", editable: false });
    expect(f.displayValue).toBeUndefined();
    expect(f.reason).toMatch(/vencida/);
    expect(orgProfilePending(st).some((x) => /vencida/.test(x.reason))).toBe(true);
    const pf: any = await preflight(a);
    expect(pf.status).toBe("BLOCKED");
    expect(pf.issues.some((i: any) => i.code === "LICITACOES_PROFILE_INCOMPLETE")).toBe(true);
    await expect(gen(a)).rejects.toThrow();
    expect(await writes(a)).toEqual({ drafts: 0, m1: 0, official: 0 });

    // padrão institucional: inelegível (data do certame) e valor inválido são RECUSADOS na escrita
    const p2 = await profileState(a);
    const base = { confirm: true as const, decision: decision(), expectedRevision: p2.revision, catalogVersion: p2.catalogVersion };
    await expect(tpl(a.org).governed.recordLicitacoesProfile({ ...base, idempotencyKey: key("d1"), defaults: { "processo.dataAbertura": "2026-12-01" } })).rejects.toThrow(/não elegível/);
    await expect(tpl(a.org).governed.recordLicitacoesProfile({ ...base, idempotencyKey: key("d2"), defaults: { "julgamento.modoDisputa": "valor-que-nao-existe" } })).rejects.toThrow(/enum|conjunto/i);
    await expect(tpl(a.org).governed.recordLicitacoesProfile({ ...base, idempotencyKey: key("d3"), defaults: { "variavel.inexistente": 1 } })).rejects.toThrow(/não declarada/);
    await expect(tpl(a.org).governed.recordLicitacoesProfile({ ...base, idempotencyKey: key("d4"), roles: { PAPEL_INEXISTENTE: { name: "x" } } })).rejects.toThrow(/papel desconhecido/);
    await expect(tpl(a.org).governed.recordLicitacoesProfile({ ...base, idempotencyKey: key("d5"), confirm: false, defaults: { "julgamento.modoDisputa": "aberto" } } as any)).rejects.toThrow();
    // padrão incompatível NO LEDGER (catálogo mudou): descartado na leitura, nunca aplicado, motivo visível
    const cur = (await readGovernedRecord(a.org, "ORG", GOVERNED_ORG_SUBJECT, BLL.catalog))!;
    const raw = { ...cur.raw, defaults: { "julgamento.modoDisputa": "valor-que-nao-existe", "processo.dataAbertura": "2026-12-01" } };
    await recordHumanDecision(ctxOf(a.org), {
      subjectType: "institutional.policy", decisionType: "institutional_policy", outcome: "estabelecida", mode: "revision", subjectId: GOVERNED_ORG_SUBJECT,
      evidence: encodeGovernedPayload(GOVERNED_FIELDS_SCHEMA, raw).evidence, act: { confirm: true, idempotencyKey: key("badledger"), decision: decision() }, expectedRevision: cur.revision,
    });
    const b = await addProcess(a, "r3eb", 1);
    const sb = await getState(b);
    const modo = sb.sections.flatMap((x) => x.fields).find((x) => x.name === "julgamento.modoDisputa")!;
    expect(modo.status).toBe("PENDING");
    expect(modo.reason).toMatch(/Padrão institucional não aplicado/);
    expect(sb.metrics.ORG_DEFAULTS_APPLIED).toBe(0);

    // IA e fontes não autorizadas NÃO afirmam parâmetros do TR; viewer não confirma
    for (const sourceType of ["ai_draft", "user", "dfd", "etp", "process", "approved_document"] as const) {
      await expect(recordContextAssertions({ organizationId: a.org, processId: a.w.processId, correlationId: "t", facts: [{ path: "tr.param.contratacao.prazoExecucao" as any, value: "{}", sourceType, sourceId: "x", sourceVersion: "v", status: "confirmed", actorUserId: 5, basisValueHash: null }] }))
        .rejects.toThrow(/CONTEXT_SOURCE_NOT_ALLOWED/);
    }
    await expect(proc(a.org, "viewer").recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.prazoExecucao": { amount: 9, unit: "day" } } })).rejects.toThrow();
  }, 900_000);

  it("R3c — conflito canônico NÃO escolhe lado (a unidade requisitante fica pendente, nunca projetada)", async () => {
    const a = await prepareOrg("r3c");
    const base = { organizationId: a.org, processId: a.w.processId, correlationId: "conflict" };
    // duas afirmações humanas de MESMA autoridade e valores distintos (sem superação consciente) ⇒ CONFLITO
    await recordContextAssertions({ ...base, facts: [
      { path: "demand.requestingUnit", value: "Secretaria A (DFD)", sourceType: "dfd", sourceId: "dfd-1", sourceVersion: "v1", status: "confirmed", actorUserId: 101, basisValueHash: null },
      { path: "demand.requestingUnit", value: "Secretaria B (usuário)", sourceType: "user", sourceId: "u-1", sourceVersion: "v1", status: "confirmed", actorUserId: 102, basisValueHash: null },
    ] });
    const st = await getState(a);
    const f = st.canonicalFields.concat([] as any).find((x) => x.name === "processo.secretariaRequisitante") ?? st.sections.flatMap((s) => s.fields).find((x) => x.name === "processo.secretariaRequisitante");
    expect(f).toBeTruthy();
    expect((f as any).status).not.toBe("AUTO");
    expect(JSON.stringify(st)).not.toContain("Secretaria A (DFD)");
    expect(JSON.stringify(st)).not.toContain("Secretaria B (usuário)");
  }, 600_000);

  it("R4 — mudança do TR estruturado / do contexto (DFD) / dos itens após o M1 ⇒ SOURCE_CHANGED; replay convergente; emitido imutável", async () => {
    const a = await prepareOrg("r4");
    await completeProfile(harnessOf(a));
    await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);
    await fillTrueDecisions(a);
    const first = await gen(a);
    expect(first.replayed).toBe(false);
    // replay convergente: mesmas autoridades ⇒ o MESMO M1 (nada novo é escrito)
    const zero = await writes(a);
    const again = await proc(a.org).generateNotice({ processId: a.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(a.tr), idempotencyKey: key("gen2") } as any) as any;
    expect(again.replayed).toBe(true);
    expect(again.generationManifestId).toBe(first.generationManifestId);
    expect(await writes(a)).toEqual(zero);
    const revalidation = async () => (await proc(a.org).editalTemplateReviewState({ processId: a.w.processId }) as any).revalidation;
    expect((await revalidation()).status).toBe("PASSED");

    // 1) TR estruturado muda (nova afirmação humana) ⇒ SOURCE_CHANGED (fonte `tr`)
    await proc(a.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.prazoExecucao": { amount: 99, unit: "day" } } });
    let rv = await revalidation();
    expect(rv.status).toBe("BLOCKED");
    expect(JSON.stringify(rv.issues)).toContain("SOURCE_CHANGED");
    expect(JSON.stringify(rv.issues)).toContain("source:tr");
    // desfazer (valor original de volta) ⇒ as fontes voltam a coincidir com o M1 (append-only: a história permanece)
    const original = scenarioValueByName("contratacao.prazoExecucao");
    await proc(a.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.prazoExecucao": original } });
    expect((await revalidation()).status).toBe("PASSED");
    expect(await count("SELECT COUNT(*) n FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? AND path = 'tr.param.contratacao.prazoExecucao'", [a.org, a.w.processId])).toBe(3);

    // 2) contexto do DFD (unidade requisitante) muda de forma CONSCIENTE (basis = valor visto) ⇒ SOURCE_CHANGED (fonte `processo`)
    await recordContextAssertions({ organizationId: a.org, processId: a.w.processId, correlationId: "dfd-change", facts: [
      { path: "demand.requestingUnit", value: "Secretaria Municipal de Obras", sourceType: "dfd", sourceId: "dfd-9", sourceVersion: "v2", status: "confirmed", actorUserId: 101, basisValueHash: factValueHash("Secretaria Municipal de Administração") },
    ] });
    rv = await revalidation();
    expect(rv.status).toBe("BLOCKED");
    expect(JSON.stringify(rv.issues)).toContain("SOURCE_CHANGED");
    expect(JSON.stringify(rv.issues)).toContain("source:processo");

    // 3) quantidade prevista de um ITEM muda (superação consciente: basis = valor visto) ⇒ SOURCE_CHANGED (fonte `itens`)
    const ctxNow: any = (await proc(a.org).canonicalContext({ processId: a.w.processId })).context;
    const item = ctxNow.items[0];
    await recordContextAssertions({ organizationId: a.org, processId: a.w.processId, correlationId: "item-change", facts: [
      { path: `items.${item.key}.plannedQuantity` as any, value: 777, sourceType: "user", sourceId: "item-change", sourceVersion: "v2", status: "confirmed", actorUserId: 101, basisValueHash: item.plannedQuantity.valueHash },
    ] });
    rv = await revalidation();
    expect(rv.status).toBe("BLOCKED");
    expect(JSON.stringify(rv.issues)).toContain("source:itens");
  }, 900_000);

  it("R5 — o TEXTO do TR e o Edital consomem os MESMOS fatos; mudar o parâmetro muda o hash (sem replay silencioso); sem parâmetros o TR permanece como antes", async () => {
    const a = await prepareOrg("r5");
    const deps = { ports: getTemplateCompositionPorts(), now: () => new Date().toISOString() };
    // sem parâmetros confirmados: nenhum bloco (comportamento anterior preservado)
    expect(await renderTrStructuredBlock(deps, a.org, a.w.processId, WS)).toBeNull();
    const plain = await generateDocument({ organizationId: a.org, processId: a.w.processId, kind: "tr", object: TR_META.object, correlationId: "r5-plain", idempotencyKey: key("r5p"), actorUserId: 101, invoke: async () => buildMockProviderAuthoring("tr") });
    expect(plain.document.content).not.toContain("PARÂMETROS ESTRUTURADOS DA CONTRATAÇÃO");

    await fillTrParams(harnessOf(a), {}, ["processo.objetoCompleto"]);
    const structured = await renderTrStructuredBlock(deps, a.org, a.w.processId, WS);
    expect(structured).not.toBeNull();
    expect(structured!.count).toBeGreaterThan(15);
    const sameKey = key("r5a");
    const gen1 = await generateDocument({
      organizationId: a.org, processId: a.w.processId, kind: "tr", object: TR_META.object, correlationId: "r5-1", idempotencyKey: sameKey, actorUserId: 101,
      invoke: async () => buildMockProviderAuthoring("tr"), structuredParams: { block: structured!.block, digest: structured!.digest },
    });
    expect(gen1.document.content).toContain("PARÂMETROS ESTRUTURADOS DA CONTRATAÇÃO");
    expect(gen1.document.sources.some((x) => x.startsWith("trparams:"))).toBe(true);
    // MESMO fato nos dois consumidores: o valor do TR (texto) é o que a fonte TR do Edital entrega
    const src = await getTemplateCompositionPorts().canonical.resolveSources(a.org, a.w.processId, ["TR"], BLL.catalog);
    expect((src.TR!.data as any).localEntrega).toBe(scenarioValueByName("contratacao.localEntrega"));
    expect(gen1.document.content).toContain(String(scenarioValueByName("contratacao.localEntrega")));
    // mudar um parâmetro ⇒ novo digest; a MESMA chave de idempotência não devolve o documento antigo (nunca replay com contexto velho)
    await proc(a.org).recordTrStructuredParams({ processId: a.w.processId, ...WS, values: { "contratacao.localEntrega": "Almoxarifado Central — Rua Sintética, 10" } });
    const changed = await renderTrStructuredBlock(deps, a.org, a.w.processId, WS);
    expect(changed!.digest).not.toBe(structured!.digest);
    await expect(generateDocument({
      organizationId: a.org, processId: a.w.processId, kind: "tr", object: TR_META.object, correlationId: "r5-2", idempotencyKey: sameKey, actorUserId: 101,
      invoke: async () => buildMockProviderAuthoring("tr"), structuredParams: { block: changed!.block, digest: changed!.digest },
    })).rejects.toThrow();
    const gen2 = await generateDocument({
      organizationId: a.org, processId: a.w.processId, kind: "tr", object: TR_META.object, correlationId: "r5-3", idempotencyKey: key("r5b"), actorUserId: 101,
      invoke: async () => buildMockProviderAuthoring("tr"), structuredParams: { block: changed!.block, digest: changed!.digest },
    });
    expect(gen2.document.content).toContain("Almoxarifado Central — Rua Sintética, 10");
    expect(gen2.document.content).not.toContain(String(scenarioValueByName("contratacao.localEntrega")));
  }, 600_000);

});

const authority = (name: string): string => authorityEntryOf(name)?.cls ?? "UNKNOWN";
