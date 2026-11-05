/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LICIGOV-FAST PR-2 — Dados orçamentários do processo (dotação/fonte) e pendência INFORMATIVA — MySQL REAL, dados SINTÉTICOS, pelas
 * MESMAS rotas e planos da tela (órgãos sintéticos numa faixa própria; nunca a organização 1; nenhum modelo de produção).
 *
 *  F1  sem dotação/fonte: preparação mostra pendência INFORMATIVA (fora das decisões e das pendências na origem); preflight pronto;
 *      Edital gerado com o marcador governado (sem [REVISAR]); M1 registra PENDING; emissão oficial permitida (autoridade/SoD intactas)
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
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedOfficialTr, seedWorld, type World,
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

  it("F1 — sem dotação/fonte: pendência INFORMATIVA; preflight pronto; Edital gerado com o marcador (sem [REVISAR]); M1 PENDING; emissão permitida", async () => {
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
    expect((await m1Of(p, ra.generationManifestId)).contentPending).toEqual([{ variable: DOT, status: "PENDING" }, { variable: FON, status: "PENDING" }]);

    // emissão oficial pelo caminho governado (revisão de outro usuário + gestor; SoD intacta): a pendência NÃO bloqueia
    const { officialId } = await reviewAndIssue(p);
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
});
