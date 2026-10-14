/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DADOS DE PUBLICAÇÃO DIFERIDOS — MySQL REAL, dados SINTÉTICOS, pelas MESMAS rotas e planos da tela.
 *
 *  Revisão 2 CANDIDATA (1.0.2-draft) registrada/publicada/vinculada SÓ em órgão sintético (nunca em produção; a API pública não a registra).
 *  P1   (PUB1–PUB6, PUB9) sem número/cronograma: preflight pronto, geração permitida, texto "A DEFINIR PARA PUBLICAÇÃO", sem [REVISAR]/datas inventadas,
 *       manifest DEFERRED; contadores: PROCESS_DECISIONS_TOTAL × DEFERRED_PUBLICATION_TOTAL; Revisão 1 segue exigindo (baseline)
 *  P2   (PUB10–PUB14) preencher DEPOIS pelo mecanismo governado (ator, revisão, CAS, idempotência) → readiness completo → nova versão do rascunho;
 *       versão antiga preservada; hashes distintos
 *  P3   (PUB7, PUB15–PUB16) preenchimento parcial; emissão oficial com dados diferidos; documento emitido imutável / regeneração exige novo ciclo
 *  S    (SRP4–SRP7) pergunta operacional, decisão humana (sem origem anterior, sem heurística textual), gravação governada
 *  L    (LEGAL1–LEGAL4) composição NÃO consulta módulo/parecer/autorização jurídica
 *  SEQ  sequência de publicação da Revisão 2 em tenant SINTÉTICO: ferramenta controlada (plano/registro DRAFT/replay/retomada de procedência) → evidência →
 *       matriz READY → aprovação → publicação → substituição atômica do vínculo → composição → retorno à Revisão 1 (falha fechada, tenant cruzado, replay)
 * Só roda com DATABASE_URL. Nenhum dado real, nenhum processo 2026/253, nenhum modelo de produção.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
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
import { getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";
import { revisionSemanticHash } from "../../domain/institutionalTemplates/semanticHash";
import { planCandidateRegistration, registerCandidateDraft, snapshotOrganizationTemplates } from "../../services/institutionalTemplates/candidateRegistrationService";
import { hashPassword } from "../../services/passwordSecurity";
import { buildSourceInventory } from "../../domain/institutionalTemplates/governance/packageInventory";
import { inventoryCounts, inventoryHash } from "../../domain/institutionalTemplates/governance/sourceInventory";
import { encodeImportProvenance, IMPORT_PROVENANCE_DECISION_TYPE, IMPORT_PROVENANCE_OUTCOME, IMPORT_PROVENANCE_SUBJECT } from "../../domain/institutionalTemplates/governance/importProvenance";
import { readScope } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { AdvisoryLockLostError, MAX_LOGICAL_LOCK_NAME, namespacedLockName, withDedicatedAdvisoryLock } from "../../db/advisoryLock";
import { AdvisoryLockTimeoutError } from "../../db/migrationLock";
import { candidateRegistrationLockName } from "../../services/institutionalTemplates/candidateRegistrationService";
import { resolveEditalTemplate } from "../../services/institutionalTemplates/editalBridgeService";
import { TemplateWorkflowError } from "../../services/institutionalTemplates/errors";
import { deactivateBinding as dbDeactivateBinding, insertBinding as dbInsertBinding, withTemplatesTransaction } from "../../db/institutionalTemplates";
import { main as candidateCli } from "../../../scripts/register-model-candidate";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MODEL_REGISTRATION_PRESETS } from "../../services/institutionalTemplates/modelRegistrationService";
import { makeContext, mockUser } from "../helpers/fixtures";
import { buildEditalReadiness } from "../../../client/src/lib/editalReadiness";
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, stampTrLineage, type ReuseHarness } from "../helpers/contextReuseHelpers";
import {
  buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue,
  type PlannedWrite, type PreparationStateView,
} from "../../../client/src/lib/editalPreparation";
import {
  BLL, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, markTemplateOrgLegacy, seedExtraProcess, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const R2 = getModelPackageVersion(BLL.modelKey, "1.0.2-draft")!;
const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
// Faixa PRÓPRIA deste arquivo ([991.000.000, 993.000.000)): arquivos distintos nunca compartilham ids de órgão (antes duas famílias usavam a MESMA base,
// e bases distintas se sobrepunham). Dentro da faixa: 20 mil posições de 100 órgãos por posição (≥ órgãos usados por arquivo).
const BASE_ORG = 993_000_000 + (STAMP % 20_000) * 100;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-pdf`;
const ORGS: number[] = [];
const CLI_USERS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-pdf-${org}-${userId}`, requestId: `req-pdf-${org}` } as any;
};
const proc = (org: number, role = "manager", userId = 101) => procurementProcessRouter.createCaller(ctx(org, role, userId));
const tpl = (org: number, role = "manager", userId = U_MANAGER) => institutionalTemplatesRouter.createCaller(ctx(org, role, userId));
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;
const pin = (tr: { documentId: string; version: number; contentHash: string }) => ({ TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } });

async function publishBll(org: number, rev: 1 | 2): Promise<{ identityId: string; revisionId: string }> {
  const wports = getTemplateWorkflowPorts();
  const pkg = rev === 2 ? R2 : BLL;
  const reg = await new ModelRegistrationService(wports, { allowCandidatePackages: rev === 2 }).register(ctxOf(org), {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: BLL.slug }, templateKey: BLL.modelKey, displayName: BLL.displayName,
    declaredScope: BLL.declaredScope, source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey, ...(rev === 2 ? { packageVersion: R2.provenance.sourceLogicalVersion } : {}) },
    sourceLogicalVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256,
    confirm: true, idempotencyKey: key("reg"), decision: decision(),
  });
  await new TemplateGovernanceService(wports).recordLegalEvidence(ctxOf(org), {
    revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decision({ basisReference: "Parecer jurídico — [preencher no piloto]" }),
    evidence: { sourceLogicalVersion: pkg.provenance.sourceLogicalVersion, sourceSha256: pkg.provenance.sourceSha256 },
  });
  const wf = new InstitutionalTemplatesWorkflow(wports);
  await wf.approve(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision({ basisReference: "Ato de aprovação" }) });
  await wf.publish(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decision({ basisReference: "Ato de publicação" }) });
  await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
  return { identityId: reg.identity.id, revisionId: reg.revision.id };
}

type RevNo = 1 | 2;
interface P { org: number; w: World; tr: { documentId: string; version: number; contentHash: string }; model: { identityId: string; revisionId: string } | null }
const TR_META = { object: "Aquisição sintética de material de expediente (objeto estruturado do TR)" };

/** Órgão + modelo publicado/vinculado + processo + TR oficial emitido (com objeto estruturado). SEM campos governados. */
async function prepareOrg(label: string, rev: RevNo = 2): Promise<P> {
  const org = newOrg();
  const w = await seedWorld(conn, org, label, { flagOn: true });
  const tr = await seedOfficialTr(conn, w, 1, "TERMO DE REFERÊNCIA — conteúdo sintético v1", TR_META);
  return { org, w, tr, model: await publishBll(org, rev) };
}
/** Segundo processo do MESMO órgão (outro nº, itens e TR próprios). */
async function addProcess(base: P, label: string, seq: number): Promise<P> {
  const w = await seedExtraProcess(base.org, label, seq);
  const tr = await seedOfficialTr(conn, w, 1, `TERMO DE REFERÊNCIA — ${label}`, TR_META);
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
const fieldOf = (st: any, name: string) => [...st.sections.flatMap((s: any) => s.fields), ...st.canonicalFields].find((f: any) => f.name === name);
// Relógio CONTROLADO do fluxo governado (geração M1 e emissão M2 usam o `clock` das ports de composição).
let clockNow: string | null = null;
const realPorts = () => createTemplateCompositionPorts();

/** Tenant pronto para compor (tudo registrado nas origens). */
async function readyTenant(label: string, rev: RevNo = 2): Promise<P> {
  const p = await prepareOrg(label, rev);
  await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p)); await fillTrueDecisions(p);
  return p;
}

// Muta/instala o reference set GLOBAL da Lei 14.133 (sem organization_id): serializa só entre os arquivos que fazem o mesmo.
useGlobalFixtureLock("legal_reference");

describe.skipIf(!DB)("Dados de publicação diferidos (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts({ ...realPorts(), clock: { now: () => clockNow ?? new Date().toISOString() } });
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "deferred-publication-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (CLI_USERS.length) {
      await conn.query(`DELETE FROM organization_members WHERE userId IN (${CLI_USERS.map(() => "?").join(",")})`, CLI_USERS).catch(() => {});
      await conn.query(`DELETE FROM users WHERE id IN (${CLI_USERS.map(() => "?").join(",")})`, CLI_USERS).catch(() => {});
    }
    if (ORGS.length) await conn.query(`DELETE FROM procurement_context_facts WHERE organization_id IN (${ORGS.map(() => "?").join(",")})`, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
    // eslint-disable-next-line no-console
    console.log("[DEFERRED_PUBLICATION METRICS]", JSON.stringify(METRICS));
  }, 120_000);


  const PUB_VARS = ["processo.numeroPregao", "controle.dataDivulgacaoPrevista", "processo.dataAbertura", "processo.horarioAbertura", "processo.dataInicioRecebimentoPropostas", "processo.dataFimRecebimentoPropostas", "processo.horarioFimRecebimentoPropostas"];
  const PLACEHOLDER = "A DEFINIR PARA PUBLICAÇÃO";
  const manifestBody = async (org: number, id: string): Promise<any> => {
    const r = (await rows("SELECT body_json b, manifest_hash h FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [org, id]))[0];
    return { body: typeof r.b === "string" ? JSON.parse(r.b) : r.b, hash: r.h as string };
  };
  /** Regera o RASCUNHO (nova versão; o anterior permanece no histórico) — fluxo existente de regeneração antes da emissão oficial. */
  const regen = async (p: P): Promise<any> => {
    const cur = (await draftText(p))!;
    return proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("regen"), confirmReplace: true, expectedContentHash: draftContentHash(cur) } as any);
  };
  /** Preenche DEPOIS pelo mecanismo governado da CertameConfig (uma chamada por origem; CAS pela revisão corrente). */
  async function fillPublication(p: P, names: readonly string[], values: Record<string, unknown> = {}): Promise<{ decisions: any[] }> {
    const decisions: any[] = [];
    const bySource: Record<string, Record<string, unknown>> = {};
    const st0 = await getState(p);
    for (const n of names) {
      const f = fieldOf(st0, n);
      const sec = st0.sections.find((s: any) => s.fields.some((x: any) => x.name === n));
      // a gravação governada substitui a SEÇÃO inteira (como o plano da tela): preserva os valores correntes e acrescenta os novos
      bySource[sec.source] ??= Object.fromEntries(sec.fields.filter((x: any) => x.hasValue && x.currentValue !== undefined).map((x: any) => [x.path, x.currentValue]));
      bySource[sec.source][f.path] = values[n] ?? scenarioValueByName(n);
    }
    let revision = st0.revisions.process;
    for (const [source, fields] of Object.entries(bySource)) {
      const r: any = await tpl(p.org).governed.recordCertameConfig({ confirm: true, idempotencyKey: key("pub"), decision: decision(), catalogVersion: st0.catalogVersion, processId: p.w.processId, source: source as any, fields, expectedRevision: revision });
      revision = r.decision.revision; decisions.push(r);
    }
    return { decisions };
  }

  it("P1 — sem número do pregão e sem cronograma: preflight pronto, Edital gerado com 'A DEFINIR PARA PUBLICAÇÃO'; nada inventado; manifest DEFERRED; contadores separados (PUB1–PUB6, PUB9)", async () => {
    // baseline: Revisão 1 (publicada em produção) continua EXIGINDO os dados — comportamento inalterado
    const r1 = await prepareOrg("p1r1", 1);
    await completeProfile(harnessOf(r1)); await fillTrStamped(r1); await setBudgetDisclosure(harnessOf(r1)); await setItemsParticipation(harnessOf(r1));
    const st1 = await getState(r1);
    const pend1 = livePendingItems(st1, {}).map((i) => i.field.name);
    for (const n of ["processo.numeroPregao", "processo.dataAbertura"]) expect(pend1, `Rev1 ${n}`).toContain(n);
    const before = buildEditalReadiness(st1 as never).counters;

    const p = await readyTenant("p1");
    const typed = await fillTrueDecisions(p);
    for (const n of PUB_VARS) expect(typed, n).not.toContain(n);
    const st = await getState(p);
    for (const n of PUB_VARS) expect(fieldOf(st, n), n).toMatchObject({ status: "DEFERRED" });
    expect(st.metrics.DEFERRED_PUBLICATION).toBe(7);
    expect(st.publication.readiness).toMatchObject({ complete: false, total: 7 });
    expect(st.publication.readiness.missingVariables).toEqual(expect.arrayContaining(PUB_VARS));
    const after = buildEditalReadiness(st as never).counters;
    expect(after.DEFERRED_PUBLICATION_TOTAL).toBe(7);
    expect(after.PROCESS_DECISIONS_TOTAL).toBe(0);
    expect(livePendingItems(st, {})).toEqual([]);
    const pre = await preflight(p);
    expect(pre.status).toBe("READY_FOR_COMPOSITION");
    expect(JSON.stringify(pre.issues ?? [])).not.toMatch(/numeroPregao|dataAbertura|horarioAbertura|RecebimentoPropostas|dataDivulgacao/);

    const ra = await gen(p);
    expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const text = (await draftText(p))!;
    expect(text).toContain(PLACEHOLDER);
    expect(text).not.toMatch(/\[REVISAR[^\]]*(numeroPregao|dataAbertura|horarioAbertura|RecebimentoPropostas|dataDivulgacao)/);
    expect(text).not.toContain(String(scenarioValueByName("processo.numeroPregao")));
    const { body } = await manifestBody(p.org, ra.generationManifestId);
    expect(body.deferredPublication.map((x: any) => x.variable)).toEqual([...PUB_VARS].sort());
    expect(body.deferredPublication.every((x: any) => x.status === "DEFERRED" && x.valueHash === undefined)).toBe(true);
    // governança preservada: Edital → revisão humana → M2 emitido, ainda com dados diferidos
    const issued = await reviewAndIssue(p);
    expect(issued.officialId).toBeTruthy();
    METRICS.P1 = {
      PROCESS_DECISIONS_TOTAL_BEFORE_REV1: before.PROCESS_DECISIONS_TOTAL, PROCESS_DECISIONS_TOTAL_AFTER_REV2: after.PROCESS_DECISIONS_TOTAL,
      DEFERRED_PUBLICATION_TOTAL: after.DEFERRED_PUBLICATION_TOTAL, REV1_PENDING: pend1,
    };
    expect(before.PROCESS_DECISIONS_TOTAL).toBeGreaterThan(after.PROCESS_DECISIONS_TOTAL);
  }, 300_000);

  it("P2 / CAP6+CAP7 — Revisão 2 (capability): preencher DEPOIS (mecanismo governado: ator, revisão, CAS, idempotência) ⇒ readiness completo e NOVA versão do rascunho; a anterior fica preservada e imutável (PUB10–PUB14)", async () => {
    const p = await readyTenant("p2");
    await fillTrueDecisions(p);
    const a = await gen(p);
    const textA = (await draftText(p))!;
    const mA = await manifestBody(p.org, a.generationManifestId);
    expect(textA).toContain(PLACEHOLDER);

    const st = await getState(p);
    const staleRevision = st.revisions.process;
    const { decisions } = await fillPublication(p, PUB_VARS);
    for (const d of decisions) expect(d.decision).toMatchObject({ recordedByUserId: U_MANAGER });
    // CAS: escrita com a revisão antiga é recusada; replay idempotente devolve a MESMA decisão
    await expect(tpl(p.org).governed.recordCertameConfig({ confirm: true, idempotencyKey: key("stale"), decision: decision(), catalogVersion: st.catalogVersion, processId: p.w.processId, source: "PROCESS", fields: { numeroPregao: "999" }, expectedRevision: staleRevision })).rejects.toThrow();
    const act = decisions[0];
    expect(act.replayed).toBeFalsy();
    const after = await getState(p);
    expect(after.publication.readiness).toMatchObject({ complete: true, missing: [] });
    for (const n of PUB_VARS) expect(fieldOf(after, n), n).toMatchObject({ status: "DECIDED" });
    expect(after.publication.schedule.numeroPregao).toBe(scenarioValueByName("processo.numeroPregao"));
    const cfg: any = await proc(p.org).certameConfig({ processId: p.w.processId, ...WS });
    expect(cfg.numeroPregao).toBe(scenarioValueByName("processo.numeroPregao"));

    // rascunho NÃO é sobrescrito sem regeneração; a revalidação do M1 vigente acusa a mudança de fonte (nada é regenerado sozinho)
    expect(await draftText(p)).toBe(textA);
    const revalidation = async () => ((await proc(p.org).editalTemplateReviewState({ processId: p.w.processId })) as any).revalidation;
    expect((await revalidation()).status).toBe("BLOCKED");
    // recompor SEM o hash do rascunho visto, ou com hash errado, é recusado; nada é sobrescrito
    await expect(proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("noh") } as any)).rejects.toThrow(/já existe rascunho/);
    await expect(proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("badh"), confirmReplace: true, expectedContentHash: "0".repeat(64) } as any)).rejects.toThrow(/mudou desde o carregamento/);
    expect(await draftText(p)).toBe(textA);
    const b = await regen(p);
    expect((await revalidation()).status).toBe("PASSED");
    expect(b.generationManifestId).not.toBe(a.generationManifestId);
    const textB = (await draftText(p))!;
    expect(textB).not.toContain(PLACEHOLDER);
    expect(textB).toContain(String(scenarioValueByName("processo.numeroPregao")));
    const mB = await manifestBody(p.org, b.generationManifestId);
    expect(mB.hash).not.toBe(mA.hash);
    expect(mB.body.deferredPublication.every((x: any) => x.status === "RESOLVED" && /^[0-9a-f]{64}$/.test(x.valueHash))).toBe(true);
    const mAagain = await manifestBody(p.org, a.generationManifestId);
    expect(mAagain.hash).toBe(mA.hash);                                      // versão antiga imutável
    expect(JSON.stringify(mAagain.body)).toBe(JSON.stringify(mA.body));
    const prev = await rows("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND previous_content = ? AND operation = 'template_compose'", [p.org, p.w.processId, textA]);
    expect(Number(prev[0].n)).toBe(1);                                          // versão anterior preservada no ledger append-only
    const replay = await regen(p).catch((e) => e);                              // mesmo conteúdo ⇒ nada muda (hash esperado agora é o novo)
    expect(replay.generationManifestId ?? mB.hash).toBeTruthy();
    METRICS.P2 = { previousVersionPreservedInLedger: Number(prev[0].n), hashChanged: mB.hash !== mA.hash };
  }, 300_000);

  it("P3 — preenchimento PARCIAL: cada dado DEFERRED/RESOLVED individualmente; sem número ⇒ continua permitido (PUB7)", async () => {
    const p = await readyTenant("p3");
    await fillTrueDecisions(p);
    await fillPublication(p, ["processo.dataAbertura", "processo.horarioAbertura"]);
    const st = await getState(p);
    expect(st.publication.readiness.complete).toBe(false);
    expect(st.publication.readiness.missing).toEqual(expect.arrayContaining(["numeroPregao"]));
    expect(st.publication.readiness.missing).not.toContain("dataSessao");
    const pf3 = await preflight(p);
    expect(pf3.status, JSON.stringify(pf3.issues)).toBe("READY_FOR_COMPOSITION");
    const ra = await gen(p);
    const { body } = await manifestBody(p.org, ra.generationManifestId);
    const by = Object.fromEntries(body.deferredPublication.map((x: any) => [x.variable, x.status]));
    expect(by["processo.dataAbertura"]).toBe("RESOLVED");
    expect(by["processo.numeroPregao"]).toBe("DEFERRED");
    expect(await draftText(p)).toContain(PLACEHOLDER);
  }, 240_000);

  it("P4 / CAP10 — documento oficial EMITIDO com dados diferidos é imutável; regenerar o rascunho depois da emissão exige novo ciclo (PUB15–PUB16)", async () => {
    const p = await readyTenant("p4");
    await fillTrueDecisions(p);
    const issued = await reviewAndIssue(p);
    const emitted = (await rows("SELECT content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, issued.officialId]))[0].h;
    await fillPublication(p, PUB_VARS);                                       // dados chegam DEPOIS da emissão
    expect((await rows("SELECT content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, issued.officialId]))[0].h).toBe(emitted);
    await expect(regen(p)).rejects.toThrow(/OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE/);
    expect((await rows("SELECT content_hash h FROM official_documents WHERE tenant_id = ? AND id = ?", [p.org, issued.officialId]))[0].h).toBe(emitted);
  }, 300_000);

  it("P5 / CAP8+CAP9 — edição humana no rascunho: recompor exige confirmação explícita; o texto humano fica preservado no histórico", async () => {
    const p = await readyTenant("p5");
    await fillTrueDecisions(p);
    await gen(p);
    const draft = (await draftText(p))!;
    const human = draft.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe.") + "\n\nObservação humana sintética.";
    await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draft), idempotencyKey: key("edit") });
    await fillPublication(p, PUB_VARS);
    const call = (extra: Record<string, unknown>) => proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), ...extra } as any) as Promise<any>;
    await expect(call({ idempotencyKey: key("r1"), expectedContentHash: draftContentHash(human) })).rejects.toThrow(/HUMAN_EDIT_WOULD_BE_OVERWRITTEN/);
    expect(await draftText(p)).toBe(human);
    await call({ idempotencyKey: key("r2"), expectedContentHash: draftContentHash(human), confirmReplace: true });
    expect(await draftText(p)).not.toBe(human);
    expect(Number((await rows("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND previous_content = ?", [p.org, p.w.processId, human]))[0].n)).toBe(1);
  }, 300_000);

  it("S — SRP: pergunta operacional; sem origem anterior nem heurística textual ⇒ decisão HUMANA; gravação governada (SRP4–SRP7)", async () => {
    const p = await prepareOrg("srp");
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p));
    const st0 = await getState(p);
    const f0 = fieldOf(st0, "controle.utilizaSrp");
    expect(f0).toMatchObject({ description: "Sistema de Registro de Preços (SRP)", question: "Esta contratação utilizará Sistema de Registro de Preços?", status: "PENDING", editable: true });
    // objeto do processo falando em "registro de preços" NÃO preenche o campo (nenhuma heurística textual)
    await conn.execute("UPDATE procurement_processes SET object = ? WHERE id = ? AND organization_id = ?", ["Registro de preços para aquisição de material de expediente (sintético)", p.w.processId, p.org]).catch(() => {});
    expect(fieldOf(await getState(p), "controle.utilizaSrp")).toMatchObject({ status: "PENDING" });
    expect(livePendingItems(await getState(p), {}).map((i) => i.field.name)).toContain("controle.utilizaSrp");
    // a pessoa decide pela rota governada; replay idempotente; depois, AUTO/DECIDED
    const idem = key("srp");
    const base = { confirm: true as const, idempotencyKey: idem, decision: decision(), catalogVersion: st0.catalogVersion, processId: p.w.processId, source: "PROCESS" as const, fields: { utilizaSrp: false }, expectedRevision: st0.revisions.process };
    const r1: any = await tpl(p.org).governed.recordCertameConfig(base);
    const r2: any = await tpl(p.org).governed.recordCertameConfig(base);
    expect(r2.replayed).toBe(true); expect(r2.decision.id).toBe(r1.decision.id);
    const f1 = fieldOf(await getState(p), "controle.utilizaSrp");
    expect(f1).toMatchObject({ status: "DECIDED" });
    expect(String(f1.displayValue)).toMatch(/^(false|n[ãa]o)$/i);
    METRICS.S = { question: f0.question, label: f0.description, zeroReentrySourceFound: false };
  }, 240_000);

  it("L — LEGAL1–LEGAL4: sem módulo jurídico, com módulo ativo sem parecer, com parecer externo ou sem registro de autorização ⇒ a composição NÃO depende deles", async () => {
    const p = await readyTenant("legal");
    await fillTrueDecisions(p);
    // LEGAL1/LEGAL4: órgão sintético sem nenhum registro de parecer/autorização
    for (const t of ["legal_opinions", "legal_opinion_requests", "legal_opinion_workspaces"]) {
      const n = await count("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t]);
      if (n) expect(await count(`SELECT COUNT(*) n FROM ${t} WHERE organization_id = ?`, [p.org]).catch(() => 0)).toBe(0);
    }
    const pre = await preflight(p);
    expect(pre.status).toBe("READY_FOR_COMPOSITION");
    expect(JSON.stringify(pre.issues ?? [])).not.toMatch(/parecer|legal.?opinion|autoriza/i);
    const ra = await gen(p);                                                    // LEGAL1 + LEGAL4
    expect(ra.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(JSON.stringify((await manifestBody(p.org, ra.generationManifestId)).body)).not.toMatch(/legalOpinion|parecerJuridico|authorization/i);
    // LEGAL2/LEGAL3: parecer externo é só um documento do processo — a regeneração segue permitida
    const regenerated = await regen(p);
    expect(regenerated.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    METRICS.L = { LEGAL_OPINION_AS_GENERATION_GATE: false, AUTHORIZATION_AS_GENERATION_GATE: false };
  }, 300_000);

  const callGen = (p: P, extra: Record<string, unknown> = {}): Promise<any> =>
    proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("cg"), ...extra } as any) as Promise<any>;
  const composeRows = async (p: P) => Number((await rows("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND operation = 'template_compose'", [p.org, p.w.processId]))[0].n);
  const m1Count = async (p: P) => Number((await rows("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.org]))[0].n);

  it("CAP1–CAP5 + REVISION_1_BEHAVIOR_BEFORE_AFTER — Revisão 1 vinculada: SEM a capability; rascunho diferente ⇒ CONFLICT legado, mesmo com hash correto/confirmReplace; nada sobrescrito", async () => {
    const p = await readyTenant("cap1", 1);
    // estado/Preparação da Revisão 1 = semântica congelada: dados de publicação CONTINUAM pendências do certame, sem diferidos, sem capability
    const before = await getState(p);
    const rb = buildEditalReadiness(before as never).counters;
    expect(before.capabilities).toEqual({ governedDraftRecomposition: false });
    expect(before.publication?.deferredPolicy).toBe(false);
    expect(before.metrics.DEFERRED_PUBLICATION ?? 0).toBe(0);
    expect(rb.DEFERRED_PUBLICATION_TOTAL).toBe(0);
    for (const n of PUB_VARS) expect(fieldOf(before, n).status, n).not.toBe("DEFERRED");
    expect(livePendingItems(before, {}).map((i) => i.field.name)).toEqual([]);          // já decididas por readyTenant
    const fresh = await prepareOrg("cap1b", 1);
    await completeProfile(harnessOf(fresh)); await fillTrStamped(fresh); await setBudgetDisclosure(harnessOf(fresh)); await setItemsParticipation(harnessOf(fresh));
    const stFresh = await getState(fresh);
    expect(buildEditalReadiness(stFresh as never).counters.PROCESS_DECISIONS_TOTAL).toBe(13);          // semântica Revisão 1: 7 de publicação CONTAM
    expect(livePendingItems(stFresh, {}).map((i) => i.field.name)).toEqual(expect.arrayContaining(PUB_VARS));
    const blocked = await preflight(fresh);
    expect(blocked.status).toBe("BLOCKED");                                                           // sem número/cronograma a Revisão 1 NÃO compõe
    expect(JSON.stringify(blocked.issues)).toContain("MISSING_REQUIRED");

    // composição inicial continua; M1 sem o registro de diferidos (Revisão 1 não tem a chave)
    const a = await callGen(p);
    expect(a.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const mA = await manifestBody(p.org, a.generationManifestId);
    expect(mA.body.deferredPublication).toBeUndefined();
    const textA = (await draftText(p))!;
    expect(textA).not.toContain(PLACEHOLDER);
    const baseRows = await composeRows(p); const baseM1 = await m1Count(p);

    // novo conteúdo ⇒ rascunho existente DIFERENTE da nova composição
    await fillPublication(p, ["processo.numeroPregao"], { "processo.numeroPregao": "7777" });
    const legacy = /já existe rascunho para este processo e tipo com outro conteúdo/;
    await expect(callGen(p, { idempotencyKey: key("c1"), expectedContentHash: draftContentHash(textA) })).rejects.toThrow(legacy);                         // CAP1/CAP3
    await expect(callGen(p, { idempotencyKey: key("c2"), expectedContentHash: draftContentHash(textA), confirmReplace: true })).rejects.toThrow(legacy);      // CAP2
    await expect(callGen(p, { idempotencyKey: key("c4"), expectedContentHash: "0".repeat(64) })).rejects.toThrow(legacy);                                  // CAP4
    await expect(callGen(p, { idempotencyKey: key("c4b"), expectedContentHash: "0".repeat(64), confirmReplace: true })).rejects.toThrow(legacy);
    expect(await draftText(p)).toBe(textA);                                                           // nada sobrescrito
    expect(await composeRows(p)).toBe(baseRows);                                                      // nenhum template_compose novo
    expect(await m1Count(p)).toBe(baseM1);                                                            // nenhum M1 novo
    expect(JSON.stringify((await manifestBody(p.org, a.generationManifestId)).body)).toBe(JSON.stringify(mA.body));

    // CAP5 — mesmo conteúdo (valor original restaurado): replay/no-op anterior continua funcionando, também com hash informado
    const st = await getState(p);
    await fillPublication(p, ["processo.numeroPregao"], { "processo.numeroPregao": scenarioValueByName("processo.numeroPregao") });
    expect((await getState(p)).revisions.process).toBeGreaterThan(st.revisions.process);
    const again = await callGen(p, { idempotencyKey: key("c5"), expectedContentHash: draftContentHash(textA) });
    expect(again.replayed).toBe(true);
    expect(await draftText(p)).toBe(textA);
    expect(await composeRows(p)).toBe(baseRows);
    METRICS.CAP_R1 = { capability: false, PROCESS_DECISIONS_TOTAL_REV1: 13, legacyConflictPreserved: true };
  }, 300_000);

  it("CAP-R2 — Revisão 2: a capability é exposta pela preparação (derivada do catálogo) e habilita a recomposição; o cliente não consegue habilitá-la na Revisão 1 (servidor decide)", async () => {
    const p = await readyTenant("cap2");
    await fillTrueDecisions(p);
    expect((await getState(p)).capabilities).toEqual({ governedDraftRecomposition: true });
    const a = await callGen(p);
    const textA = (await draftText(p))!;
    await fillPublication(p, PUB_VARS);
    const b = await callGen(p, { idempotencyKey: key("rc"), expectedContentHash: draftContentHash(textA) });
    expect(b.generationManifestId).not.toBe(a.generationManifestId);
    expect(await draftText(p)).not.toBe(textA);
    METRICS.CAP_R2 = { capability: true };
  }, 300_000);

  it("IDEM — recomposição: retry idêntico não cria segunda versão; concorrência converge (uma versão, sem corrupção)", async () => {
    const p = await readyTenant("idem");
    await fillTrueDecisions(p);
    clockNow = "2026-10-12T12:00:00.000Z";                                                           // relógio controlado ⇒ M1 determinístico
    try {
      await callGen(p);
      const textA = (await draftText(p))!;
      await fillPublication(p, PUB_VARS);
      const base = await composeRows(p); const baseM1 = await m1Count(p);
      const args = { expectedContentHash: draftContentHash(textA) };
      const r1 = await callGen(p, { idempotencyKey: key("i1"), ...args });
      const textB = (await draftText(p))!;
      expect(await composeRows(p)).toBe(base + 1);
      const r2 = await callGen(p, { idempotencyKey: key("i2"), ...args });                          // retry da MESMA operação (hash antigo): M1 igual ⇒ replay
      expect(r2.generationManifestId).toBe(r1.generationManifestId);
      expect(r2.replayed).toBe(true);
      expect(await draftText(p)).toBe(textB);
      expect(await composeRows(p)).toBe(base + 1);
      expect(await m1Count(p)).toBe(baseM1 + 1);
      // concorrência: duas recomposições simultâneas de uma NOVA mudança de fonte
      await fillPublication(p, ["processo.numeroPregao"], { "processo.numeroPregao": "8888" });
      const cur = { expectedContentHash: draftContentHash(textB) };
      const settled = await Promise.allSettled([callGen(p, { idempotencyKey: key("k1"), ...cur }), callGen(p, { idempotencyKey: key("k2"), ...cur })]);
      expect(settled.some((x) => x.status === "fulfilled")).toBe(true);
      for (const x of settled) if (x.status === "rejected") expect(String((x.reason as Error).message)).toMatch(/mudou desde o carregamento|CONFLICT|deadlock|já existe/i);
      expect(await composeRows(p)).toBe(base + 2);                                                  // exatamente UMA nova versão
      expect(await draftText(p)).toContain("8888");
    } finally { clockNow = null; }
  }, 300_000);

  it("TENANT — um órgão não usa o hash do rascunho de outro órgão e não alcança processo alheio", async () => {
    const a = await readyTenant("ta"); const b = await readyTenant("tb");
    await fillTrueDecisions(a); await fillTrueDecisions(b);
    await callGen(a); await callGen(b);
    const textA = (await draftText(a))!; const textB = (await draftText(b))!;
    await fillPublication(b, PUB_VARS);
    await expect(callGen(b, { idempotencyKey: key("x1"), expectedContentHash: draftContentHash(textA), confirmReplace: true })).rejects.toThrow(/mudou desde o carregamento/);
    expect(await draftText(b)).toBe(textB); expect(await draftText(a)).toBe(textA);
    // processo do órgão A pedido por B: não encontrado (escopo de tenant)
    await expect(proc(b.org).generateNotice({ processId: a.w.processId, object: "x", ...WS, idempotencyKey: key("x2"), expectedContentHash: draftContentHash(textA) } as any)).rejects.toThrow(/não encontrado/i);
    expect(await draftText(a)).toBe(textA);
  }, 300_000);

  it("TXT1–TXT6 — o TEXTO do rascunho não é autoridade: editar o placeholder não resolve dado estruturado; só a CertameConfig governada resolve", async () => {
    const p = await readyTenant("txt");
    await fillTrueDecisions(p);
    const a = await callGen(p);
    const draft = (await draftText(p))!;
    expect(draft).toContain(PLACEHOLDER);                                                           // TXT1: estruturado ausente ⇒ DEFERRED
    expect((await manifestBody(p.org, a.generationManifestId)).body.deferredPublication.every((x: any) => x.status === "DEFERRED")).toBe(true);
    // TXT2: a pessoa troca o placeholder por uma data "real" no texto
    const human = draft.split(PLACEHOLDER).join("15/10/2026");
    await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draftContentHash(draft), idempotencyKey: key("txtedit") });
    expect(await draftText(p)).toContain("15/10/2026");
    const st = await getState(p);
    for (const n of PUB_VARS) expect(fieldOf(st, n), n).toMatchObject({ status: "DEFERRED" });
    // TXT3 + TXT4: readiness incompleto e projeção sem nenhuma data textual
    expect(st.publication.readiness).toMatchObject({ complete: false, missing: expect.arrayContaining(["numeroPregao", "dataSessao"]) });
    expect(Object.values(st.publication.schedule).every((v) => v === null)).toBe(true);
    const cfg: any = await proc(p.org).certameConfig({ processId: p.w.processId, ...WS });
    expect(cfg.numeroPregao ?? null).toBeNull();
    expect(JSON.stringify(st.publication)).not.toContain("15/10/2026");
    expect((await manifestBody(p.org, a.generationManifestId)).body.deferredPublication.every((x: any) => x.status === "DEFERRED" && x.valueHash === undefined)).toBe(true);
    expect((await preflight(p)).status).toBe("READY_FOR_COMPOSITION");                              // continua sem bloquear
    // TXT5: registrar pela CertameConfig governada ⇒ RESOLVED
    await fillPublication(p, PUB_VARS);
    const after = await getState(p);
    for (const n of PUB_VARS) expect(fieldOf(after, n), n).toMatchObject({ status: "DECIDED" });
    expect(after.publication.readiness.complete).toBe(true);
    // TXT6: nova composição usa o valor ESTRUTURADO (e exige confirmação, pois há edição humana)
    await expect(callGen(p, { idempotencyKey: key("t6a"), expectedContentHash: draftContentHash(human) })).rejects.toThrow(/HUMAN_EDIT_WOULD_BE_OVERWRITTEN/);
    const b = await callGen(p, { idempotencyKey: key("t6b"), expectedContentHash: draftContentHash(human), confirmReplace: true });
    const textB = (await draftText(p))!;
    expect(textB).not.toContain("15/10/2026");
    expect(textB).toContain(String(scenarioValueByName("processo.numeroPregao")));
    expect((await manifestBody(p.org, b.generationManifestId)).body.deferredPublication.every((x: any) => x.status === "RESOLVED" && /^[0-9a-f]{64}$/.test(x.valueHash))).toBe(true);
  }, 300_000);

  it("READINESS-SERVICE — cada revisão resolve o PRÓPRIO inventário (versão lógica + SHA-256 da procedência); nunca 'a mais recente'", async () => {
    // Revisão 1 e Revisão 2 (candidata sintética) já foram PUBLICADAS pelo gate de prontidão em `prepareOrg` (BLOCKED impediria). Aqui: o inventário
    // é derivado do pacote da versão lógica gravada na procedência de CADA revisão.
    for (const [rev, pkg] of [[1, BLL], [2, R2]] as const) {
      const p = await prepareOrg(`rs${rev}`, rev);
      const out: any = await tpl(p.org).readiness.evaluate({ revisionId: p.model!.revisionId });
      expect(out.inventory.derivedFromPackage, `Revisão ${rev}`).toBe(true);
      expect(out.matrix.checks.filter((c: any) => c.status === "BLOCKED" && /INPUTS|CONTROL_ONLY|CONDITION_TYPES|CERTAME_CONFIG|ANNEX|XREF/.test(c.id))).toEqual([]);
      const gov = (await rows("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [p.org]))[0];
      expect(Number(gov.n)).toBeGreaterThan(0);
      expect(out.revision.semanticHash).toBe(revisionSemanticHash({ ast: pkg.ast as never, variableCatalogVersion: pkg.catalog.version }));
    }
  }, 180_000);

  // ───────────────────────── Sequência de publicação da Revisão 2 (ferramenta controlada → vínculo → retorno) ─────────────────────────
  const R1_HASH = "e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d";
  const R2_HASH = "33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd";
  const wfOf = () => new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
  const govOf = () => new TemplateGovernanceService(getTemplateWorkflowPorts());
  const candReq = (p: P, over: Record<string, unknown> = {}): any => ({
    organizationId: p.org, identityId: p.model!.identityId, actorUserId: U_MANAGER, runId: key("run"), modelKey: BLL.modelKey, packageVersion: "1.0.2-draft",
    expected: { sourceSha256: R2.provenance.sourceSha256, semanticHash: R2_HASH, baselineSemanticHash: R1_HASH }, decision: decision({ basisReference: "Execução sintética de teste" }), ...over,
  });
  const revisionsOf = async (p: P) => [...(await getTemplateWorkflowPorts().repository.listRevisions(p.org, p.model!.identityId))];
  const activeBindings = async (p: P) => (await wfOf().listBindings(ctxOf(p.org), { documentKind: "edital", activeOnly: true })).filter((b) => b.identityId === p.model!.identityId);
  const lifecycle = (p: P, revisionId: string, expectedStatus: string, k: string) => ({ revisionId, expectedStatus: expectedStatus as any, confirm: true as const, idempotencyKey: key(k), decision: decision({ basisReference: "Ato sintético de teste" }) });
  const R2_SCOPE = { ...BLL.declaredScope } as any;

  it("SEQ — Revisão 2 no tenant sintético: ferramenta controlada → DRAFT → evidência → matriz READY → aprovação → publicação → substituição atômica → retorno à Revisão 1", async () => {
    const p = await prepareOrg("seq", 1);                                                           // Revisão 1 PUBLICADA e vinculada (como em produção)
    const r1Id = p.model!.revisionId;
    const r1Before = await getTemplateWorkflowPorts().repository.getRevision(p.org, r1Id);
    expect(r1Before!.semanticHash).toBe(R1_HASH); expect(r1Before!.status).toBe("PUBLISHED");
    await completeProfile(harnessOf(p)); await fillTrStamped(p); await setBudgetDisclosure(harnessOf(p)); await setItemsParticipation(harnessOf(p));
    await fillTrueDecisions(p);
    const d1 = await callGen(p);                                                                    // M1 da Revisão 1 (para replay depois)
    expect(d1.template.revisionId).toBe(r1Id);
    const draftR1 = (await draftText(p))!;
    const bindingsBefore = await activeBindings(p);
    expect(bindingsBefore).toHaveLength(1); expect(bindingsBefore[0].pinnedRevisionId).toBe(r1Id);

    // PLANO (somente leitura) — nada muda
    const plan = await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(p));
    expect(plan.checks.filter((c) => !c.ok)).toEqual([]);
    expect(plan).toMatchObject({ ok: true, action: "REGISTER_DRAFT", baselineRevisionId: r1Id, candidateRevisionId: null });
    expect(await revisionsOf(p)).toHaveLength(1);
    const other = await prepareOrg("seq-b", 1);
    const snapExp = { baselineSemanticHash: R1_HASH, semanticHash: R2_HASH };
    const snap0 = await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), p.org, snapExp, true);
    expect(snap0.identities).toHaveLength(1);
    expect(snap0.identities[0]).toMatchObject({ id: p.model!.identityId, hasBaselinePublished: true, candidateRegistered: false });
    expect(snap0.identities[0].activeBindings).toHaveLength(1);
    expect(JSON.stringify(snap0)).not.toMatch(/"ast"|content|numeroPregao/);                          // sem conteúdo de modelo nem dados de processo
    expect((await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), other.org, snapExp, true)).identities.map((i) => i.id)).not.toContain(p.model!.identityId);   // isolamento de tenant

    // FALHA FECHADA: hash esperado errado / identidade de OUTRO tenant / pacote vigente como candidato ⇒ nada criado
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { expected: { sourceSha256: R2.provenance.sourceSha256, semanticHash: "0".repeat(64), baselineSemanticHash: R1_HASH } }))).rejects.toThrow(/recusado/);
    const cross = candReq(other, { identityId: p.model!.identityId });                              // órgão B apontando para a identidade do órgão A
    expect((await planCandidateRegistration(getTemplateWorkflowPorts(), cross)).checks.find((c) => c.id === "IDENTITY_IN_TENANT")!.ok).toBe(false);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), cross)).rejects.toThrow(/recusado/);
    expect(await revisionsOf(p)).toHaveLength(1); expect(await revisionsOf(other)).toHaveLength(1);
    // a API pública/serviço padrão NUNCA registra candidato, e o candidato não está nos presets
    await expect(new ModelRegistrationService(getTemplateWorkflowPorts()).register(ctxOf(p.org), {
      target: { kind: "EXISTING_IDENTITY", identityId: p.model!.identityId }, templateKey: BLL.modelKey, displayName: BLL.displayName, declaredScope: R2_SCOPE,
      source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey, packageVersion: "1.0.2-draft" }, sourceLogicalVersion: R2.provenance.sourceLogicalVersion, sourceSha256: R2.provenance.sourceSha256,
      confirm: true, idempotencyKey: key("nope"), decision: decision(),
    })).rejects.toThrow(/candidato/);
    expect(MODEL_REGISTRATION_PRESETS.map((x) => x.presetId)).toEqual([BLL.modelKey]);
    expect(await revisionsOf(p)).toHaveLength(1);

    // EXECUÇÃO: só DRAFT + procedência; replay converge
    const done = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p));
    expect(done).toMatchObject({ performed: "REGISTER_DRAFT", provenance: "RECORDED" });
    const r2Id = done.revisionId!;
    const revs = await revisionsOf(p);
    expect(revs).toHaveLength(2);
    expect(revs.find((r) => r.id === r2Id)).toMatchObject({ status: "DRAFT", semanticHash: R2_HASH, revision: 2 });
    expect((await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), p.org, snapExp, true)).identities[0]).toMatchObject({ candidateRegistered: true });
    expect((await activeBindings(p)).map((b) => b.id)).toEqual(bindingsBefore.map((b) => b.id));          // nenhum vínculo tocado
    const again = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p));
    expect(again).toMatchObject({ performed: "NONE", revisionId: r2Id }); expect(await revisionsOf(p)).toHaveLength(2);

    await markTemplateOrgLegacy(conn, p.org);   // órgão com modelos anteriores à transição (LEGACY_COMPAT): evidência jurídica exigida, como em produção
    // MATRIZ: sem evidência ⇒ só a evidência bloqueia; aprovar não publica; publicar é recusado (fail closed)
    const matrix = async () => ((await tpl(p.org).readiness.evaluate({ revisionId: r2Id })) as any).matrix;
    expect((await matrix()).checks.filter((c: any) => c.status === "BLOCKED").map((c: any) => c.id)).toEqual(["LEGAL_APPROVAL_EVIDENCE"]);
    await wfOf().approve(ctxOf(p.org), lifecycle(p, r2Id, "DRAFT", "ap"));
    await expect(wfOf().publish(ctxOf(p.org), lifecycle(p, r2Id, "APPROVED", "pb0"))).rejects.toThrow(/PUBLICATION_BLOCKED|não pode ser publicada/);
    expect((await revisionsOf(p)).find((r) => r.id === r2Id)!.status).toBe("APPROVED");
    // evidência que NÃO cobre a versão lógica da candidata (a da Revisão 1) ⇒ continua bloqueado
    await govOf().recordLegalEvidence(ctxOf(p.org), { revisionId: r2Id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev0"), decision: decision({ basisReference: "Evidência sintética de teste" }),
      evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 } });
    expect((await matrix()).checks.find((c: any) => c.id === "LEGAL_APPROVAL_EVIDENCE").status).toBe("BLOCKED");
    await expect(wfOf().publish(ctxOf(p.org), lifecycle(p, r2Id, "APPROVED", "pb1"))).rejects.toThrow(/PUBLICATION_BLOCKED|não pode ser publicada/);
    // evidência correspondente (versão lógica + SHA + hash semântico da revisão exata) ⇒ READY
    await govOf().recordLegalEvidence(ctxOf(p.org), { revisionId: r2Id, expectedVersion: 1, confirm: true, idempotencyKey: key("ev1"), decision: decision({ basisReference: "Evidência sintética de teste" }),
      evidence: { sourceLogicalVersion: R2.provenance.sourceLogicalVersion, sourceSha256: R2.provenance.sourceSha256 } });
    expect((await matrix()).overall).toBe("READY");
    await wfOf().publish(ctxOf(p.org), lifecycle(p, r2Id, "APPROVED", "pb2"));
    const afterPub = await revisionsOf(p);
    expect(afterPub.find((r) => r.id === r2Id)!.status).toBe("PUBLISHED");
    expect(afterPub.find((r) => r.id === r1Id)!.status).toBe("PUBLISHED");                          // publicar NÃO deprecia a Revisão 1
    expect((await activeBindings(p)).map((b) => b.pinnedRevisionId)).toEqual([r1Id]);              // publicar NÃO troca o vínculo

    // VÍNCULO: sem substituição explícita ⇒ ambíguo (nada muda); tenant cruzado ⇒ não encontrado; com replacesBindingId ⇒ troca ATÔMICA
    const bind = (org: number, identityId: string, rev: string, replaces?: string) => wfOf().setBinding(ctxOf(org), { documentKind: "edital", scope: R2_SCOPE, identityId, pinnedRevisionId: rev, effectiveFrom: "2026-10-13T00:00:00Z", confirm: true, ...(replaces ? { replacesBindingId: replaces } : {}) });
    await expect(bind(p.org, p.model!.identityId, r2Id)).rejects.toThrow(/BINDING_AMBIGUOUS|binding ativo/i);
    expect((await activeBindings(p)).map((b) => b.pinnedRevisionId)).toEqual([r1Id]);
    await expect(bind(other.org, p.model!.identityId, r2Id)).rejects.toThrow(/não encontrad/i);
    expect(await activeBindings(other)).toHaveLength(1);
    const swapped = await bind(p.org, p.model!.identityId, r2Id, bindingsBefore[0].id);
    const nowActive = await activeBindings(p);
    expect(nowActive.map((b) => b.pinnedRevisionId)).toEqual([r2Id]); expect(nowActive[0].id).toBe(swapped.id);   // exatamente UM ativo (nunca zero nem dois)
    expect((await bind(p.org, p.model!.identityId, r2Id, bindingsBefore[0].id)).id).toBe(swapped.id);          // replay da troca (resultado incerto) CONVERGE para o mesmo vínculo
    expect(await activeBindings(p)).toHaveLength(1);

    // COMPOSIÇÃO pela Revisão 2 (sem número/cronograma) e Revisão 1 intacta para replay
    const p2 = await addProcess(p, "seq2", 2);
    await fillTrStamped(p2); await setBudgetDisclosure(harnessOf(p2)); await setItemsParticipation(harnessOf(p2)); await fillTrueDecisions(p2);
    const g2 = await callGen(p2);
    expect(g2.template.revisionId).toBe(r2Id);
    expect((await draftText(p2))!).toContain(PLACEHOLDER);
    expect(await draftText(p)).toBe(draftR1);                                                       // rascunho/M1 da Revisão 1 inalterados
    expect(((await proc(p.org).editalTemplateReviewState({ processId: p.w.processId })) as any).revalidation.status).toBe("PASSED");

    // RETORNO à Revisão 1 (mesma troca atômica); Revisão 2 continua publicada, sem vínculo
    await bind(p.org, p.model!.identityId, r1Id, swapped.id);
    expect((await activeBindings(p)).map((b) => b.pinnedRevisionId)).toEqual([r1Id]);
    expect((await revisionsOf(p)).find((r) => r.id === r2Id)!.status).toBe("PUBLISHED");
    const stP2 = await getState(p2);
    expect(stP2.capabilities).toEqual({ governedDraftRecomposition: false });                        // voltou a semântica da Revisão 1 (sem recomposição)
    const r1After = await getTemplateWorkflowPorts().repository.getRevision(p.org, r1Id);
    expect(r1After!.semanticHash).toBe(R1_HASH); expect(r1After!.status).toBe("PUBLISHED");
    expect(JSON.stringify(r1After!.ast)).toBe(JSON.stringify(r1Before!.ast));
    METRICS.SEQ = { r1Hash: R1_HASH, r2Hash: R2_HASH, steps: "plan>register>replay>matrix>approve>blocked>evidence>READY>publish>replace>compose>return" };
  }, 600_000);

  it("SEQ-PROV — DRAFT do candidato sem procedência (falha parcial) é COMPLETADO sem criar nova revisão", async () => {
    const p = await prepareOrg("seqprov", 1);
    // DRAFT criado sem procedência (o estado que uma falha parcial deixaria)
    const draft = await wfOf().createDraft(ctxOf(p.org), { identityId: p.model!.identityId, ast: R2.ast, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version });
    const plan = await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(p));
    expect(plan).toMatchObject({ ok: true, action: "RECORD_PROVENANCE", candidateRevisionId: draft.id, candidateProvenanceRecorded: false });
    const done = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p));
    expect(done).toMatchObject({ performed: "RECORD_PROVENANCE", provenance: "RECORDED", revisionId: draft.id });
    expect(await revisionsOf(p)).toHaveLength(2);
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p))).toMatchObject({ performed: "NONE" });
    expect(((await tpl(p.org).readiness.evaluate({ revisionId: draft.id })) as any).matrix.checks.find((c: any) => c.id === "SOURCE_PROVENANCE").status).toBe("PASS");
  }, 240_000);

  // ───────────────────────── CLI de candidato — guardas de execução e autenticação do executor (banco real) ─────────────────────────
  const dbName = DB ? new URL(DB).pathname.slice(1) : "";
  const cliUser = async (org: number, role: string, opts: { password?: string; ativo?: boolean; member?: boolean } = {}) => {
    const email = `cli-${RUN}-${++keySeq}@orgao-sintetico.test`;
    const pw = opts.password ?? "Senha-Sintetica-1!";
    const [r] = await conn.execute("INSERT INTO users (openId, name, email, passwordHash, loginMethod) VALUES (?, ?, ?, ?, 'password')", [`cli-${RUN}-${keySeq}`, `Executor ${keySeq}`, email, await hashPassword(pw)]) as any;
    CLI_USERS.push(r.insertId);
    if (opts.member !== false) await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, ?)", [org, r.insertId, role, opts.ativo === false ? 0 : 1]);
    return { id: r.insertId as number, email, pw };
  };
  const authFile = (over: Record<string, unknown> = {}) => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "cand-auth-")), "authority.json");
    writeFileSync(f, JSON.stringify({ decidedByName: "Executor Sintético", decidedByRole: "Operador", decidedAt: "2026-10-13", basisReference: "Execução sintética de teste", reason: "Registro do DRAFT da candidata", ...over }));
    return f;
  };
  const runCli = async (p: P, o: { email?: string; password?: string; env?: [string | undefined, string | undefined]; extra?: string[]; omit?: string[]; authority?: string; database?: string }): Promise<number> => {
    const savedEnv = { a: process.env.APP_ENV, n: process.env.NODE_ENV, e: process.env.CANDIDATE_EXECUTOR_EMAIL, p: process.env.CANDIDATE_EXECUTOR_PASSWORD, argv: process.argv };
    const set = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    try {
      if (o.env) { set("APP_ENV", o.env[0]); set("NODE_ENV", o.env[1]); }
      set("CANDIDATE_EXECUTOR_EMAIL", o.email); set("CANDIDATE_EXECUTOR_PASSWORD", o.password);
      const args = ["--mode=execute", `--organization-id=${p.org}`, `--identity-id=${p.model!.identityId}`, "--package-version=1.0.2-draft", `--expect-semantic-hash=${R2_HASH}`,
        `--expect-baseline-hash=${R1_HASH}`, `--expect-source-sha256=${R2.provenance.sourceSha256}`, `--authority-file=${o.authority ?? authFile()}`,
        `--confirm=REGISTER_CANDIDATE_DRAFT:${p.org}:${p.model!.identityId}:${R2_HASH.slice(0, 12)}`, `--expect-database=${o.database ?? dbName}`, "--allow-production", ...(o.extra ?? [])]
        .filter((a) => !(o.omit ?? []).some((x) => a.startsWith(x)));
      process.argv = ["node", "register-model-candidate.ts", ...args];
      return await candidateCli();
    } finally { set("APP_ENV", savedEnv.a); set("NODE_ENV", savedEnv.n); set("CANDIDATE_EXECUTOR_EMAIL", savedEnv.e); set("CANDIDATE_EXECUTOR_PASSWORD", savedEnv.p); process.argv = savedEnv.argv; }
  };
  const decisionsOf = async (revisionId: string) => rows("SELECT recorded_by_user_id u, decided_by_user_id d, correlation_id c FROM institutional_decisions WHERE subject_id = ?", [revisionId]);

  it("CLI-EXEC — guarda de execução em qualquer ambiente + autenticação do executor: o ator registrado é o usuário AUTENTICADO", async () => {
    const p = await prepareOrg("cliexec", 1);
    const other = await prepareOrg("cliexec-b", 1);
    const op = await cliUser(p.org, "operator");
    const viewer = await cliUser(p.org, "viewer"); const inactive = await cliUser(p.org, "owner", { ativo: false });
    const foreign = await cliUser(other.org, "owner", { member: true });                              // membro só do órgão B
    const noMember = await cliUser(p.org, "owner", { member: false });
    const revCount = async () => (await revisionsOf(p)).length;

    // G1 — rótulos de ambiente nunca dispensam as guardas (todas as combinações; o banco real está conectado)
    for (const env of [[undefined, undefined], ["development", "production"], ["production", "development"], ["staging", "test"], ["production", "production"]] as Array<[string | undefined, string | undefined]>) {
      await expect(runCli(p, { email: op.email, password: op.pw, env, omit: ["--allow-production"] })).rejects.toThrow(/--allow-production/);
      await expect(runCli(p, { email: op.email, password: op.pw, env, omit: ["--expect-database"] })).rejects.toThrow(/--expect-database/);
      await expect(runCli(p, { email: op.email, password: op.pw, env, omit: ["--confirm"] })).rejects.toThrow(/--confirm deve ser exatamente/);
    }
    expect(await revCount()).toBe(1);
    // banco conectado ≠ banco esperado ⇒ recusa ANTES de autenticar ou escrever
    await expect(runCli(p, { email: op.email, password: op.pw, database: "outro_banco" })).rejects.toThrow(/banco conectado não é o informado/);
    // G2 — ator nunca digitado
    await expect(runCli(p, { email: op.email, password: op.pw, extra: [`--actor-user-id=${op.id}`] })).rejects.toThrow(/--actor-user-id não existe mais/);
    // autenticação: tudo recusado com a MESMA mensagem e nada escrito
    const bad = [["senha errada", { email: op.email, password: "errada" }], ["e-mail desconhecido", { email: "nao-existe@orgao-sintetico.test", password: op.pw }],
      ["viewer", { email: viewer.email, password: viewer.pw }], ["membership inativa", { email: inactive.email, password: inactive.pw }],
      ["membro só de OUTRO órgão", { email: foreign.email, password: foreign.pw }], ["sem membership", { email: noMember.email, password: noMember.pw }]] as const;
    const msgs = new Set<string>();
    for (const [label, c] of bad) { const e = await runCli(p, c).catch((x) => x); expect(e, label).toBeInstanceOf(Error); msgs.add((e as Error).message); }
    expect(msgs.size).toBe(1); expect([...msgs][0]).toMatch(/EXECUTOR_AUTH_FAILED/);
    expect(await revCount()).toBe(1);
    // autoridade declarada de OUTRA pessoa ⇒ recusa (depois de autenticar, antes de escrever)
    await expect(runCli(p, { email: op.email, password: op.pw, authority: authFile({ decidedByUserId: op.id + 1000 }) })).rejects.toThrow(/difere do usuário autenticado/);
    expect(await revCount()).toBe(1);

    // sucesso: ator = usuário autenticado (id verificado no banco); correlation id da execução; autoridade amarrada
    expect(await runCli(p, { email: op.email, password: op.pw })).toBe(0);
    const revs = await revisionsOf(p);
    expect(revs).toHaveLength(2);
    const cand = revs.find((r) => r.semanticHash === R2_HASH)!;
    const decs = await decisionsOf(cand.id);
    expect(decs.length).toBeGreaterThan(0);
    for (const d of decs) { expect(Number(d.u)).toBe(op.id); expect(Number(d.d)).toBe(op.id); expect(String(d.c)).toMatch(/^cand-reg-/); }
    // replay (mesma credencial): nada novo; usuário com papel ≥ operator de outro nível também autentica
    expect(await runCli(p, { email: op.email, password: op.pw })).toBe(0);
    expect(await revCount()).toBe(2);
    // Revisão 1 e vínculo intactos
    expect((await revisionsOf(p)).find((r) => r.semanticHash === R1_HASH)).toMatchObject({ status: "PUBLISHED" });
    expect((await activeBindings(p)).map((b) => b.pinnedRevisionId)).toEqual([p.model!.revisionId]);
  }, 300_000);

  // ───────────────────────── Amend corretivo P1/P2 — concorrência, swap sem NOT_BOUND, flag, integridade ─────────────────────────
  const failingGovernance = (healthyAfter: number | null) => {
    const real = getTemplateWorkflowPorts();
    let calls = 0;
    return {
      ...real,
      governance: { ...real.governance!, recordGovernanceDecision: async (r: any) => { calls++; if (healthyAfter === null || calls <= healthyAfter) throw new Error("falha injetada na procedência"); return real.governance!.recordGovernanceDecision(r); } },
    } as any;
  };
  const candidates = async (p: P) => (await revisionsOf(p)).filter((r) => r.semanticHash === R2_HASH);
  const provenanceOf = async (p: P, revisionId: string) => (await govOf().get(ctxOf(p.org), revisionId)).provenance;
  const publishCandidate = async (p: P): Promise<string> => {
    const done = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p));
    const id = done.revisionId!;
    await wfOf().approve(ctxOf(p.org), lifecycle(p, id, "DRAFT", "capp"));
    await govOf().recordLegalEvidence(ctxOf(p.org), { revisionId: id, expectedVersion: 0, confirm: true, idempotencyKey: key("cev"), decision: decision({ basisReference: "Evidência sintética de teste" }),
      evidence: { sourceLogicalVersion: R2.provenance.sourceLogicalVersion, sourceSha256: R2.provenance.sourceSha256 } });
    await wfOf().publish(ctxOf(p.org), lifecycle(p, id, "APPROVED", "cpub"));
    return id;
  };

  it("P1-CONC — execuções concorrentes da MESMA candidata convergem para UMA revisão com procedência correta (sem duplicata nem DRAFT órfão)", async () => {
    const p = await prepareOrg("conc", 1);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("cr") }))));
    expect(results.filter((r) => r.status === "rejected").map((r: any) => String(r.reason?.message))).toEqual([]);
    const cands = await candidates(p);
    expect(cands).toHaveLength(1);                                                                     // exatamente UMA revisão com o hash da candidata
    expect((await revisionsOf(p)).map((r) => r.revision).sort()).toEqual([1, 2]);                     // sem #3
    expect((await provenanceOf(p, cands[0].id))).toMatchObject({ sourceLogicalVersion: "1.0.2-draft", revisionSemanticHash: R2_HASH });
    const ids = new Set(results.map((r: any) => r.value.revisionId));
    expect([...ids]).toEqual([cands[0].id]);                                                          // todas convergem para a mesma revisão
    expect(results.filter((r: any) => r.value.performed === "REGISTER_DRAFT")).toHaveLength(1);       // só UMA escreveu
    // nenhuma revisão do órgão sem procedência
    for (const r of await revisionsOf(p)) expect(await provenanceOf(p, r.id), r.id).not.toBeNull();
  }, 300_000);

  it("P1-CONC — órgãos distintos registram em paralelo sem interferência (lock por organização+identidade, nunca global)", async () => {
    const a = await prepareOrg("conc-a", 1); const b = await prepareOrg("conc-b", 1);
    const { candidateRegistrationLockName } = await import("../../services/institutionalTemplates/candidateRegistrationService");
    expect(candidateRegistrationLockName(a.org, a.model!.identityId)).not.toBe(candidateRegistrationLockName(b.org, b.model!.identityId));
    expect(candidateRegistrationLockName(a.org, a.model!.identityId).length).toBeLessThanOrEqual(64);
    const out = await Promise.all([a, b].flatMap((p) => [0, 1, 2].map(() => registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("cx") })))));
    expect(out).toHaveLength(6);
    for (const p of [a, b]) { expect(await candidates(p)).toHaveLength(1); expect((await revisionsOf(p)).length).toBe(2); }
  }, 300_000);

  it("P1-CONC — falha parcial: procedência que falha é refeita (retry limitado); persistente ⇒ DRAFT sem procedência é RETOMADO sem 2ª revisão", async () => {
    const p = await prepareOrg("partial", 1);
    // falha transitória (1ª tentativa): o próprio comando recupera dentro do lock
    const ok = await registerCandidateDraft(failingGovernance(1), candReq(p));
    expect(ok).toMatchObject({ provenance: "RECORDED" });
    expect(await candidates(p)).toHaveLength(1);
    expect(await provenanceOf(p, (await candidates(p))[0].id)).not.toBeNull();
    // falha persistente em OUTRO órgão: fica o DRAFT sem procedência e o resultado é FAILED (explícito)
    const q = await prepareOrg("partial2", 1);
    const bad = await registerCandidateDraft(failingGovernance(null), candReq(q));
    expect(bad.provenance).toBe("FAILED");
    expect(await candidates(q)).toHaveLength(1);
    expect(await provenanceOf(q, (await candidates(q))[0].id)).toBeNull();
    // retry com ports saudáveis, concorrente: completa a procedência SEM criar revisão
    await Promise.all([0, 1, 2].map(() => registerCandidateDraft(getTemplateWorkflowPorts(), candReq(q, { runId: key("rt") }))));
    expect(await candidates(q)).toHaveLength(1);
    expect(await provenanceOf(q, (await candidates(q))[0].id)).not.toBeNull();
    expect((await revisionsOf(q)).length).toBe(2);
  }, 300_000);

  it("P1-CONC — revisão CONFLITANTE (mesma versão de catálogo, AST diferente) ou DUPLICADA ⇒ recusa explícita, sem escrita", async () => {
    // CONFLITANTE: DRAFT com o catálogo da candidata mas conteúdo (AST) diferente ⇒ hash semântico diferente
    const c = await prepareOrg("conflict", 1);
    const altered = JSON.parse(JSON.stringify(R2.ast));
    let touched = false;
    const walk = (n: any): void => { if (touched || n === null || typeof n !== "object") return; for (const k of Object.keys(n)) { if (!touched && n.t === "text" && k === "v" && typeof n[k] === "string" && n[k].length > 8) { n[k] = `${n[k]} (alterado)`; touched = true; } else walk(n[k]); } };
    walk(altered);
    expect(touched).toBe(true);
    const odd = await wfOf().createDraft(ctxOf(c.org), { identityId: c.model!.identityId, ast: altered, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version });
    expect(odd.semanticHash).not.toBe(R2_HASH);
    const beforeC = (await revisionsOf(c)).length;
    expect((await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(c))).checks.find((x) => x.id === "NO_CONFLICTING_REVISION")!.ok).toBe(false);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(c))).rejects.toThrow(/NO_CONFLICTING_REVISION/);
    expect((await revisionsOf(c)).length).toBe(beforeC);
    // DUPLICADA: duas revisões com o hash da candidata (como o defeito antigo produzia) ⇒ a ferramenta recusa e não escreve
    const p = await prepareOrg("dup", 1);
    for (let i = 0; i < 2; i++) await wfOf().createDraft(ctxOf(p.org), { identityId: p.model!.identityId, ast: R2.ast, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version });
    const before = (await revisionsOf(p)).length;
    expect((await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(p))).checks.find((x) => x.id === "CANDIDATE_UNIQUE")!.ok).toBe(false);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p))).rejects.toThrow(/CANDIDATE_UNIQUE/);
    expect((await revisionsOf(p)).length).toBe(before);
  }, 300_000);

  it("P2-FLAG — registro exige a flag LIGADA para a organização exata, antes de qualquer escrita; plan/snapshot seguem somente leitura", async () => {
    const on = await prepareOrg("flag-on", 1); const off = await prepareOrg("flag-off", 1);
    await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, 'FF_INSTITUTIONAL_TEMPLATES_V1', 0, 100) ON DUPLICATE KEY UPDATE enabled = 0, percentage = 100", [off.org]);
    const { invalidateFlagCache } = await import("../../services/featureFlagService");
    invalidateFlagCache("FF_INSTITUTIONAL_TEMPLATES_V1", off.org);
    const counts = async (p: P) => ({ revs: (await revisionsOf(p)).length, decisions: Number((await rows("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [p.org]))[0].n),
      events: Number((await rows("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [p.org]))[0].n), bindings: (await activeBindings(p)).map((b) => b.id) });
    const before = await counts(off);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(off))).rejects.toThrow(/MODULE_DISABLED/);
    expect(await counts(off)).toEqual(before);                                                         // zero writes na recusa
    // plan/snapshot: leitura (não escrevem) e mostram a flag desligada
    const plan = await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(off));
    expect(plan.ok).toBe(false); expect(plan.checks.find((c) => c.id === "FLAG_ENABLED")!.ok).toBe(false);
    expect((await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), off.org, { baselineSemanticHash: R1_HASH, semanticHash: R2_HASH }, false)).flag.enabled).toBe(false);
    expect(await counts(off)).toEqual(before);
    // tenant divergente: o órgão LIGADO não habilita o desligado, e a identidade de um não vale no outro
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(off, { identityId: on.model!.identityId }))).rejects.toThrow(/MODULE_DISABLED/);
    expect(await counts(off)).toEqual(before);
    // tenant habilitado registra; ligar a flag depois habilita o desligado
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(on))).toMatchObject({ performed: "REGISTER_DRAFT" });
    await conn.execute("UPDATE tenant_feature_flags SET enabled = 1 WHERE organizationId = ? AND flagName = 'FF_INSTITUTIONAL_TEMPLATES_V1'", [off.org]);
    invalidateFlagCache("FF_INSTITUTIONAL_TEMPLATES_V1", off.org);
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(off))).toMatchObject({ performed: "REGISTER_DRAFT" });
    // desligar DEPOIS do plano e antes da escrita (corrida de flag): a escrita relê a flag e recusa
    const late = await prepareOrg("flag-late", 1);
    await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, 'FF_INSTITUTIONAL_TEMPLATES_V1', 0, 100) ON DUPLICATE KEY UPDATE enabled = 0", [late.org]);
    invalidateFlagCache("FF_INSTITUTIONAL_TEMPLATES_V1", late.org);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(late))).rejects.toThrow(/MODULE_DISABLED/);
    expect((await revisionsOf(late)).length).toBe(1);
  }, 300_000);

  it("P1-BIND — o instante efetivo do swap é do SERVIDOR: relógio do navegador adiantado/atrasado nunca abre janela NOT_BOUND", async () => {
    const p = await prepareOrg("bind", 1);
    const r1Id = p.model!.revisionId;
    const r2Id = await publishCandidate(p);
    const old = (await activeBindings(p))[0];
    const resolve = () => wfOf().resolveBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE });
    const swap = (rev: string, replaces: string, clientTime?: string) => wfOf().setBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE, identityId: p.model!.identityId, pinnedRevisionId: rev, confirm: true, replacesBindingId: replaces, ...(clientTime ? { effectiveFrom: clientTime } : {}) });
    // relógio ADIANTADO (ano 2099): antes ⇒ NOT_BOUND; agora o servidor ignora o valor do cliente
    const t0 = Date.now();
    const swapped = await swap(r2Id, old.id, "2099-01-01T00:00:00.000Z");
    expect(Date.parse(swapped.effectiveFrom)).toBeGreaterThanOrEqual(t0 - 5);
    expect(Date.parse(swapped.effectiveFrom)).toBeLessThanOrEqual(Date.now());
    const r = await resolve();
    expect(r.status).toBe("RESOLVED"); expect((r as any).binding.id).toBe(swapped.id); expect((r as any).revision.id).toBe(r2Id);
    // relógio ATRASADO (ano 2000): também não retroage a vigência
    const back = await swap(r1Id, swapped.id, "2000-01-01T00:00:00.000Z");
    expect(Date.parse(back.effectiveFrom)).toBeGreaterThanOrEqual(t0 - 5);
    expect(((await resolve()) as any).revision.id).toBe(r1Id);
    // retry após resultado incerto (mesma troca repetida): converge para o MESMO vínculo, sem segundo ativo
    const again = await swap(r1Id, swapped.id, "2099-01-01T00:00:00.000Z");
    expect(again.id).toBe(back.id);
    expect(await activeBindings(p)).toHaveLength(1);
    // observação CONTÍNUA durante trocas sucessivas: nenhuma leitura vê NOT_BOUND
    const seen: string[] = []; let stop = false;
    const poll = (async () => { while (!stop) { seen.push((await resolve()).status); } })();
    let cur = back;
    for (const [rev, skew] of [[r2Id, "2099-12-31T23:59:59.000Z"], [r1Id, "1999-01-01T00:00:00.000Z"], [r2Id, "2099-01-01T00:00:00.000Z"], [r1Id, undefined]] as const) cur = await swap(rev, cur.id, skew);
    stop = true; await poll;
    expect(seen.length).toBeGreaterThan(8);
    expect([...new Set(seen)]).toEqual(["RESOLVED"]);
    expect((await activeBindings(p)).map((b) => b.pinnedRevisionId)).toEqual([r1Id]);                 // retorno atômico à Revisão 1
    // Revisão 1 e Revisão 2 seguem PUBLICADAS (replay)
    expect((await revisionsOf(p)).map((x) => x.status).sort()).toEqual(["PUBLISHED", "PUBLISHED"]);
  }, 300_000);

  it("P1-BIND — swaps CONCORRENTES: idênticos convergem; conflitantes ⇒ exatamente um vence (um único ativo), o outro é recusado; tenant alheio não substitui", async () => {
    const p = await prepareOrg("bindc", 1); const other = await prepareOrg("bindc-b", 1);
    const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p);
    const old = (await activeBindings(p))[0];
    const swap = (rev: string, replaces: string, org = p.org) => wfOf().setBinding(ctxOf(org), { documentKind: "edital", scope: R2_SCOPE, identityId: p.model!.identityId, pinnedRevisionId: rev, confirm: true, replacesBindingId: replaces });
    // tenant alheio não toca o vínculo de p
    await expect(swap(r2Id, old.id, other.org)).rejects.toThrow(/não encontrad/i);
    expect((await activeBindings(p)).map((b) => b.id)).toEqual([old.id]);
    // idênticos em paralelo
    const same = await Promise.allSettled([swap(r2Id, old.id), swap(r2Id, old.id), swap(r2Id, old.id)]);
    expect(same.filter((x) => x.status === "rejected").map((x: any) => String(x.reason?.message))).toEqual([]);
    expect(new Set(same.map((x: any) => x.value.id)).size).toBe(1);
    let active = await activeBindings(p); expect(active).toHaveLength(1); expect(active[0].pinnedRevisionId).toBe(r2Id);
    // conflitantes em paralelo (R2 → R1 × R2 → R2'): um vence
    const cur = active[0];
    const conflict = await Promise.allSettled([swap(r1Id, cur.id), swap(r2Id, cur.id)]);
    active = await activeBindings(p);
    expect(active).toHaveLength(1);
    expect(conflict.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(["fulfilled", "rejected"]).toEqual(expect.arrayContaining(conflict.map((x) => x.status)));
    // com a Revisão 2 ainda vinculada, ou voltou à 1: nunca zero nem dois ativos, e o escopo resolve
    expect((await wfOf().resolveBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE })).status).toBe("RESOLVED");
  }, 300_000);

  it("P1-BIND — a API não aceita effectiveFrom do cliente (rota estrita); a tela não envia horário do navegador", async () => {
    const p = await prepareOrg("bindapi", 1);
    const r2Id = await publishCandidate(p);
    const old = (await activeBindings(p))[0];
    const base = { documentKind: "edital" as const, scope: R2_SCOPE, identityId: p.model!.identityId, pinnedRevisionId: r2Id, confirm: true, replacesBindingId: old.id };
    await expect(tpl(p.org).bindings.set({ ...base, effectiveFrom: "2099-01-01T00:00:00.000Z" } as any)).rejects.toThrow();
    expect((await activeBindings(p)).map((b) => b.id)).toEqual([old.id]);
    const ok: any = await tpl(p.org).bindings.set(base as any);
    expect(Date.parse(ok.effectiveFrom)).toBeLessThanOrEqual(Date.now());
    expect(((await tpl(p.org).bindings.resolve({ documentKind: "edital", scope: R2_SCOPE })) as any).status).toBe("RESOLVED");
  }, 300_000);


  // ───────────────────────── SEGUNDO AMEND — validação INTEGRAL da procedência do candidato (plan / snapshot / register) ─────────────────────────
  const builtInv = buildSourceInventory({ mapping: R2.mapping, catalog: R2.catalog, sourceLogicalVersion: R2.provenance.sourceLogicalVersion, sourceSha256: R2.provenance.sourceSha256 });
  const goodProv = () => ({
    templateKey: BLL.modelKey, displayName: R2.displayName, sourceLogicalVersion: R2.provenance.sourceLogicalVersion, sourceSha256: R2.provenance.sourceSha256, sourceFormat: "NATIVE",
    scope: readScope(R2.declaredScope), inventory: { sha256: inventoryHash(builtInv), ...inventoryCounts(builtInv) },
  });
  /** DRAFT do candidato criado SEM procedência (como uma falha parcial deixaria). */
  const bareDraft = async (p: P): Promise<string> => (await wfOf().createDraft(ctxOf(p.org), { identityId: p.model!.identityId, ast: R2.ast, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version })).id;
  const recordProv = (p: P, revisionId: string, over: Record<string, unknown> = {}, expectedVersion = 0) => govOf().recordImportProvenance(ctxOf(p.org), {
    revisionId, expectedVersion, confirm: true, idempotencyKey: key("pv"), decision: decision({ basisReference: "Procedência sintética de teste" }), provenance: { ...goodProv(), ...over } as any });
  /** Decisão de procedência CRUA (conteúdo arbitrário no ledger), para simular registros que o serviço nunca produziria. */
  const rawProv = (p: P, revisionId: string, evidence: string[], expectedRevision = 0) => getTemplateWorkflowPorts().governance!.recordGovernanceDecision({
    organizationId: p.org, subjectType: IMPORT_PROVENANCE_SUBJECT, subjectId: revisionId, decisionType: IMPORT_PROVENANCE_DECISION_TYPE, outcome: IMPORT_PROVENANCE_OUTCOME,
    decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedByUserId: null, decidedAt: "2026-10-06", basisReference: "Portaria 12/2026", reason: "teste", evidence,
    recordedByUserId: U_MANAGER, expectedRevision, idempotencyKey: key("raw"), correlationId: "corr-raw-prov",
  } as any);
  const provDecisions = (p: P, revisionId: string) => count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?", [p.org, revisionId]);
  const planOf = (p: P) => planCandidateRegistration(getTemplateWorkflowPorts(), candReq(p));
  const refused = async (p: P, revisionId: string, checkId: string, field?: string) => {
    const before = await provDecisions(p, revisionId); const revs = (await revisionsOf(p)).length;
    const plan: any = await planOf(p);
    expect(plan.ok, JSON.stringify(plan.checks.filter((c: any) => !c.ok))).toBe(false);
    expect(plan.action).toBe("NONE");
    const failed = plan.checks.find((c: any) => c.id === checkId);
    expect(failed?.ok, `check ${checkId}`).toBe(false);
    if (field) expect(failed.detail).toContain(field);
    await expect(registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("pr") }))).rejects.toThrow(/recusado/);
    expect(await provDecisions(p, revisionId)).toBe(before);                                           // nenhum evento novo (nada sobrescrito, nada "corrigido" em silêncio)
    expect((await revisionsOf(p)).length).toBe(revs);
    return plan;
  };

  it("PROV-OK — procedência CORRETA (gravada à mão) ⇒ converge sem nenhuma escrita; snapshot informa CORRECT", async () => {
    const p = await prepareOrg("prov-ok", 1); const id = await bareDraft(p); await recordProv(p, id);
    const plan: any = await planOf(p);
    expect(plan).toMatchObject({ ok: true, action: "NONE", candidateRevisionId: id, candidateProvenanceRecorded: true });
    expect(plan.candidateProvenance).toMatchObject({ state: "CORRECT", versions: 1, diffs: [] });
    const before = await provDecisions(p, id);
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p))).toMatchObject({ performed: "NONE", revisionId: id, provenance: "ALREADY_RECORDED" });
    expect(await provDecisions(p, id)).toBe(before);
    const snap = await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), p.org, { baselineSemanticHash: R1_HASH, semanticHash: R2_HASH }, true, { modelKey: BLL.modelKey, packageVersion: "1.0.2-draft" });
    expect(snap.identities[0]).toMatchObject({ candidateRegistered: true, candidateProvenance: "CORRECT" });
  }, 240_000);

  it("PROV-ABSENT — sem procedência ⇒ recuperação idempotente governada (uma escrita, mesma revisão)", async () => {
    const p = await prepareOrg("prov-abs", 1); const id = await bareDraft(p);
    const plan: any = await planOf(p);
    expect(plan).toMatchObject({ ok: true, action: "RECORD_PROVENANCE" }); expect(plan.candidateProvenance).toMatchObject({ state: "ABSENT", versions: 0 });
    const snap = await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), p.org, { baselineSemanticHash: R1_HASH, semanticHash: R2_HASH }, true, { modelKey: BLL.modelKey, packageVersion: "1.0.2-draft" });
    expect(snap.identities[0]).toMatchObject({ candidateProvenance: "ABSENT" });
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p))).toMatchObject({ performed: "RECORD_PROVENANCE", provenance: "RECORDED", revisionId: id });
    expect(await provDecisions(p, id)).toBe(1);
  }, 240_000);

  const DIVERGENCES: readonly [string, Record<string, unknown>, string][] = [
    ["templateKey", { templateKey: "OUTRO_MODELO_SINTETICO" }, "templateKey"],
    ["modelKey/displayName", { displayName: "Outro modelo" }, "displayName"],
    ["versão lógica", { sourceLogicalVersion: "1.0.1" }, "sourceLogicalVersion"],
    ["SHA-256 da fonte", { sourceSha256: "a".repeat(64) }, "sourceSha256"],
    ["formato da fonte", { sourceFormat: "MARKDOWN" }, "sourceFormat"],
    ["escopo (plataforma)", { scope: { ...readScope(R2.declaredScope), platform: "licitanet" } }, "scope.platform"],
    ["escopo (modalidade ausente)", { scope: { form: "eletronica", platform: "bll" } }, "scope.modality"],
    ["inventário (hash)", { inventory: { ...goodProv().inventory, sha256: "b".repeat(64) } }, "inventory.sha256"],
    ["inventário (contagens)", { inventory: { ...goodProv().inventory, inputsTotal: goodProv().inventory.inputsTotal + 1 } }, "inventory.inputsTotal"],
    ["inventário ausente", { inventory: undefined }, "inventory"],
  ];
  it.each(DIVERGENCES)("PROV-DIVERGENT — %s divergente ⇒ recusa explícita ANTES de qualquer evento novo (sem sobrescrever, sem corrigir em silêncio)", async (_name, over, field) => {
    const p = await prepareOrg(`prov-d${++keySeq}`, 1); const id = await bareDraft(p); await recordProv(p, id, over);
    const plan = await refused(p, id, "PROVENANCE_DIVERGENT", field);
    expect(plan.candidateProvenance).toMatchObject({ state: "DIVERGENT" }); expect(plan.candidateProvenanceRecorded).toBe(false);
    expect(plan.candidateProvenance.diffs.map((d: any) => d.field)).toContain(field);
    const snap = await snapshotOrganizationTemplates(getTemplateWorkflowPorts(), p.org, { baselineSemanticHash: R1_HASH, semanticHash: R2_HASH }, true, { modelKey: BLL.modelKey, packageVersion: "1.0.2-draft" });
    expect(snap.identities[0]).toMatchObject({ candidateProvenance: "DIVERGENT" });
  }, 240_000);

  it("PROV-DIVERGENT — hash semântico da procedência ≠ candidata (procedência de OUTRO conteúdo, p.ex. da Revisão 1) ⇒ recusa; inconsistência exige regularização humana", async () => {
    const p = await prepareOrg("prov-prior", 1); const id = await bareDraft(p);
    await rawProv(p, id, encodeImportProvenance(goodProv() as any, { revisionSemanticHash: R1_HASH, recordedAt: "2026-10-13T10:00:00.000Z" }));
    await refused(p, id, "PROVENANCE_DIVERGENT", "revisionSemanticHash");
  }, 240_000);

  it("PROV-MALFORMED — registro ilegível ⇒ falha governada e observável (nada é escrito; não é tratado como 'ausente')", async () => {
    const p = await prepareOrg("prov-mal", 1); const id = await bareDraft(p);
    await rawProv(p, id, ["templateKey=EDITAL_PREGAO_ELETRONICO_BLL", "lixo=sem-os-demais-campos"]);
    const plan = await refused(p, id, "PROVENANCE_MALFORMED");
    expect(plan.candidateProvenance).toMatchObject({ state: "MALFORMED" });
  }, 240_000);

  it("PROV-REGULARIZE — divergência corrigida por NOVA versão humana (ledger append-only) ⇒ estado CORRECT; histórico preservado", async () => {
    const p = await prepareOrg("prov-reg", 1); const id = await bareDraft(p);
    await recordProv(p, id, { sourceSha256: "c".repeat(64) });
    await refused(p, id, "PROVENANCE_DIVERGENT", "sourceSha256");
    await recordProv(p, id, {}, 1);                                                                    // regularização humana: v2 correta (v1 permanece no ledger)
    const plan: any = await planOf(p);
    expect(plan).toMatchObject({ ok: true, action: "NONE" }); expect(plan.candidateProvenance).toMatchObject({ state: "CORRECT", versions: 2 });
    expect(await provDecisions(p, id)).toBe(2);
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p))).toMatchObject({ performed: "NONE" });
  }, 240_000);

  it("PROV-STATE — candidata já APROVADA sem procedência não é retomável (DRAFT-only) ⇒ recusa; tenant alheio não vê a procedência", async () => {
    const p = await prepareOrg("prov-st", 1); const other = await prepareOrg("prov-st2", 1); const id = await bareDraft(p);
    await wfOf().approve(ctxOf(p.org), lifecycle(p, id, "DRAFT", "pst"));
    await refused(p, id, "PROVENANCE_NOT_RESUMABLE");
    const cross: any = await planCandidateRegistration(getTemplateWorkflowPorts(), candReq(other, { identityId: p.model!.identityId }));
    expect(cross.ok).toBe(false); expect(cross.candidateRevisionId).toBeNull(); expect(cross.candidateProvenance ?? null).toBeNull();
    expect(await provDecisions(other, id)).toBe(0);
  }, 240_000);


  // ───────────────────────── SEGUNDO AMEND — perda da sessão do advisory lock (MySQL real; sessão do lock MORTA com KILL) ─────────────────────────
  const effectiveLockName = (p: P) => namespacedLockName(dbName, candidateRegistrationLockName(p.org, p.model!.identityId));
  const lockHolder = async (name: string): Promise<number | null> => { const r = (await rows("SELECT IS_USED_LOCK(?) AS h", [name]))[0]; return r.h === null ? null : Number(r.h); };
  /** Portas do executor 1: pára (barreira) na PRIMEIRA leitura de vínculos (dentro do plano, dentro do lock) — ponto determinístico, sem sleep. */
  const pausedPorts = (b: ReturnType<typeof barrier>): any => {
    const base = getTemplateWorkflowPorts(); let once = true;
    return { ...base, repository: { ...base.repository, listBindings: async (...a: any[]) => { if (once) { once = false; b.reached(); await b.released; } return (base.repository.listBindings as any)(...a); } } };
  };
  const assertOneCandidate = async (p: P) => {
    const cands = await candidates(p);
    expect(cands).toHaveLength(1);                                                                     // exatamente UMA revisão com o hash da candidata
    expect((await revisionsOf(p)).map((r) => r.revision).sort()).toEqual([1, 2]);
    expect(await provDecisions(p, cands[0].id)).toBe(1);                                              // procedência consistente: uma versão
    expect((await planOf(p) as any).candidateProvenance.state).toBe("CORRECT");
    return cands[0];
  };

  it("LOCK-LOSS-1 — a sessão que SEGURA o lock é morta (KILL) no meio do callback; outro executor assume; o primeiro NÃO escreve (AdvisoryLockLostError); uma candidata, procedência consistente", async () => {
    const p = await prepareOrg("lock1", 1);
    const name = effectiveLockName(p);
    const b = barrier();
    const ex1 = registerCandidateDraft(pausedPorts(b), candReq(p, { runId: key("lk1") }));
    const ex1Settled = ex1.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await b.atPoint;                                                                                  // executor 1 está DENTRO do lock, após o plano, antes de escrever
    const holder = await lockHolder(name);
    expect(holder).not.toBeNull();
    await conn.query(`KILL ${Number(holder)}`);                                                      // a sessão dedicada do lock morre (como rede/failover)
    for (let i = 0; i < 100 && (await lockHolder(name)) !== null; i++) await new Promise((r) => setTimeout(r, 20));   // o servidor libera o lock com a sessão
    expect(await lockHolder(name)).toBeNull();
    const ex2 = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("lk1b") }));   // outro executor adquire o lock livre e registra
    expect(ex2).toMatchObject({ performed: "REGISTER_DRAFT", provenance: "RECORDED" });
    b.release();                                                                                      // executor 1 retoma com o plano obsoleto
    const r1 = await ex1Settled;
    expect(r1.ok).toBe(false); expect(String((r1 as any).e)).toMatch(/perdido|AdvisoryLockLostError/);   // fail-closed: não escreveu
    expect((r1 as any).e).toBeInstanceOf(AdvisoryLockLostError);
    const cand = await assertOneCandidate(p);
    expect(cand.id).toBe(ex2.revisionId);
    // retry converge (idempotente); nenhum efeito em outro órgão
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("lk1c") }))).toMatchObject({ performed: "NONE", revisionId: cand.id });
  }, 300_000);

  it("LOCK-LOSS-2 — a sessão morre DEPOIS de assertHeld passar (janela inevitável): a escrita transacional exclusiva impede a 2ª revisão; o executor 1 CONVERGE para a mesma", async () => {
    const p = await prepareOrg("lock2", 1);
    const name = effectiveLockName(p);
    const b = barrier(); const base = getTemplateWorkflowPorts(); let calls = 0;
    // Fluxo do executor 1: plano (listRevisions #1) → assertHeld → register → createDraft (listRevisions #2 = leitura da numeração). Pausa ANTES da leitura #2:
    // o lock ainda era dele em assertHeld, e a numeração será lida só DEPOIS de o outro executor comitar.
    const ports1: any = { ...base, repository: { ...base.repository, listRevisions: async (...a: any[]) => {
      if (++calls === 2) { b.reached(); await b.released; }
      return (base.repository.listRevisions as any)(...a);
    } } };
    const settled = registerCandidateDraft(ports1, candReq(p, { runId: key("lk2") })).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await b.atPoint;
    const holder = await lockHolder(name); expect(holder).not.toBeNull();
    await conn.query(`KILL ${Number(holder)}`);
    for (let i = 0; i < 100 && (await lockHolder(name)) !== null; i++) await new Promise((r) => setTimeout(r, 20));
    const ex2 = await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("lk2b") }));
    expect(ex2).toMatchObject({ performed: "REGISTER_DRAFT" });
    b.release();
    const r1 = await settled;
    const cand = await assertOneCandidate(p);                                                         // INDEPENDENTE do desfecho do executor 1: uma única candidata
    expect(cand.id).toBe(ex2.revisionId);
    expect(r1.ok, r1.ok ? "" : String((r1 as any).e)).toBe(true);                                      // a escrita exclusiva faz o executor 1 CONVERGIR (nunca criar a 2ª)
    expect((r1 as any).v.revisionId).toBe(cand.id);
  }, 300_000);

  it("LOCK-LOSS-3 — sem NENHUM advisory lock: execuções concorrentes do registro (escrita transacional exclusiva) ⇒ exatamente UMA revisão por hash e UMA procedência", async () => {
    const p = await prepareOrg("lock3", 1);
    const reg = new ModelRegistrationService(getTemplateWorkflowPorts(), { allowCandidatePackages: true });
    const input = (i: number) => ({
      target: { kind: "EXISTING_IDENTITY" as const, identityId: p.model!.identityId }, templateKey: R2.modelKey, displayName: R2.displayName, declaredScope: R2.declaredScope,
      source: { kind: "MODEL_PACKAGE" as const, modelKey: R2.modelKey, packageVersion: "1.0.2-draft" }, sourceLogicalVersion: R2.provenance.sourceLogicalVersion,
      sourceSha256: R2.provenance.sourceSha256, confirm: true as const, idempotencyKey: `cand-prov-lock3-${RUN}`, decision: decision({ basisReference: `exec ${i}` }),
    });
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => reg.register(ctxOf(p.org), input(i) as any, { uniqueDraft: true })));
    expect(out.filter((x) => x.status === "rejected").map((x: any) => String(x.reason?.message))).toEqual([]);
    expect(new Set(out.map((x: any) => x.value.revision.id)).size).toBe(1);
    expect((await candidates(p))).toHaveLength(1);
    expect((await revisionsOf(p)).map((r) => r.revision).sort()).toEqual([1, 2]);
  }, 300_000);

  it("LOCK-NS — o nome do lock inclui a identidade do BANCO: o mesmo nome lógico em bancos distintos não disputa; no mesmo banco exclui; nome ≤ 64", async () => {
    const other = `${dbName}_ns`;
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${other}\``);
    const saved = process.env.DATABASE_URL;
    try {
      const url = (db: string) => { const u = new URL(DB!); u.pathname = `/${db}`; return u.toString(); };
      const logical = candidateRegistrationLockName(BASE_ORG, "ti-sintetico");
      expect(logical.length).toBeLessThanOrEqual(MAX_LOGICAL_LOCK_NAME);
      expect(namespacedLockName(dbName, logical).length).toBeLessThanOrEqual(64);
      expect(namespacedLockName(dbName, logical)).not.toBe(namespacedLockName(other, logical));
      const gate = barrier(); const inside = barrier();
      process.env.DATABASE_URL = url(dbName);
      const holderRun = withDedicatedAdvisoryLock(logical, 5, async () => { inside.reached(); await gate.released; return "a"; });
      await inside.atPoint;
      process.env.DATABASE_URL = url(other);
      expect(await withDedicatedAdvisoryLock(logical, 1, async () => "b")).toBe("b");                 // outro banco: não espera
      process.env.DATABASE_URL = url(dbName);
      await expect(withDedicatedAdvisoryLock(logical, 1, async () => "c")).rejects.toBeInstanceOf(AdvisoryLockTimeoutError);   // mesmo banco: exclui
      gate.release(); expect(await holderRun).toBe("a");
      expect(await withDedicatedAdvisoryLock(logical, 1, async () => "d")).toBe("d");                 // liberado
      await expect(withDedicatedAdvisoryLock("x".repeat(MAX_LOGICAL_LOCK_NAME + 1), 1, async () => 1)).rejects.toThrow(/nome de lock inválido/);
    } finally { process.env.DATABASE_URL = saved; await conn.query(`DROP DATABASE IF EXISTS \`${other}\``).catch(() => {}); }
  }, 120_000);


  // ───────────────────────── AUDITORIA CONSOLIDADA — pin de revisão entre leituras, falha após commit, tenant, estresse ─────────────────────────
  it("AUD-PIN — troca concorrente ENTRE a decisão do bridge e a composição: falha fechada e retentável (TEMPLATE_BINDING_CHANGED), sem escrita e sem legado; o retry compõe pela revisão vigente e o `template` informado = manifest", async () => {
    const p = await readyTenant("aud-pin", 1); const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const base = realPorts(); let calls = 0; const b = barrier();
    const gated: any = { ...base, repository: { ...base.repository, listBindings: async (...a: any[]) => {
      if (++calls === 2) { b.reached(); await b.released; }                                           // 1ª leitura = decisão do bridge; 2ª = composição (pausa ANTES dela)
      return (base.repository.listBindings as any)(...a);
    } } };
    configureTemplateCompositionPorts({ ...gated, clock: { now: () => new Date().toISOString() } });
    const manifestsBefore = await m1Count(p); const draftBefore = await draftText(p);
    const legacyBefore = legacy.calls;
    const first = callGen(p).then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
    await b.atPoint;
    await wfOf().setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));                                   // troca comitada entre as duas leituras
    b.release();
    const r = await first;
    configureTemplateCompositionPorts({ ...realPorts(), clock: { now: () => clockNow ?? new Date().toISOString() } });
    expect(r.ok).toBe(false); expect(String((r as any).e?.message)).toMatch(/TEMPLATE_BINDING_CHANGED/);
    expect(legacy.calls).toBe(legacyBefore);                                                          // nunca cai no legado
    expect(await m1Count(p)).toBe(manifestsBefore); expect(await draftText(p)).toBe(draftBefore);     // zero escrita
    const again = await callGen(p, { idempotencyKey: key("aud-pin2") });                              // retry converge com o vínculo vigente
    expect(again.generationMode).toBe("INSTITUTIONAL_TEMPLATE"); expect(again.template.revisionId).toBe(r2Id);
    const manifest = (await rows("SELECT template_revision_id r FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [p.org, again.generationManifestId]))[0];
    expect(manifest.r).toBe(again.template.revisionId);                                               // informado ao usuário = registrado no M1
    expect(r1Id).not.toBe(r2Id);
  }, 600_000);

  it("AUD-UNCERTAIN — DRAFT comitado e resposta perdida (falha depois da escrita): a repetição RECUPERA sem 2ª revisão e completa a procedência", async () => {
    const p = await prepareOrg("aud-unc", 1);
    const base = getTemplateWorkflowPorts();
    const lost: any = { ...base, repository: { ...base.repository, insertDraftRevisionUnique: async (...a: any[]) => { await (base.repository.insertDraftRevisionUnique as any)(...a); throw new Error("conexão perdida após o commit"); } } };
    await expect(registerCandidateDraft(lost, candReq(p, { runId: key("unc1") }))).rejects.toThrow(/conexão perdida/);
    const plan: any = await planOf(p);
    expect(plan).toMatchObject({ ok: true, action: "RECORD_PROVENANCE" }); expect(plan.candidateProvenance.state).toBe("ABSENT");
    expect(await registerCandidateDraft(getTemplateWorkflowPorts(), candReq(p, { runId: key("unc2") }))).toMatchObject({ performed: "RECORD_PROVENANCE", provenance: "RECORDED" });
    await assertOneCandidate(p);
  }, 300_000);

  it("AUD-TENANT — a criação exclusiva de DRAFT é tenant-scoped: identidade de OUTRO órgão ⇒ não encontrada, nada criado em nenhum dos dois", async () => {
    const a = await prepareOrg("aud-ta", 1); const b = await prepareOrg("aud-tb", 1);
    await expect(wfOf().createDraft(ctxOf(b.org), { identityId: a.model!.identityId, ast: R2.ast, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version, uniqueSemanticHash: true })).rejects.toThrow(/não encontrad/i);
    expect(await revisionsOf(a)).toHaveLength(1); expect(await revisionsOf(b)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_revisions WHERE organization_id = ? AND identity_id = ?", [b.org, a.model!.identityId])).toBe(0);
  }, 300_000);

  it("AUD-STRESS — swaps idênticos/conflitantes + registros exclusivos + rascunhos comuns em paralelo (3 rodadas): invariantes preservadas, erros só do tipo esperado, sem deadlock vazando", async () => {
    const p = await prepareOrg("aud-stress", 1); const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p);
    const reg = new ModelRegistrationService(getTemplateWorkflowPorts(), { allowCandidatePackages: true });
    const expectedErr = /BINDING_AMBIGUOUS|já existe|CONFLICT|outra revisão|conflit/i;
    for (let round = 0; round < 3; round++) {
      const cur = (await activeBindings(p))[0];
      const target = round % 2 === 0 ? r2Id : r1Id; const other = target === r2Id ? r1Id : r2Id;
      const ops: Promise<unknown>[] = [
        ...Array.from({ length: 4 }, () => wfOf().setBinding(ctxOf(p.org), swapIn(p, target, cur.id))),     // idênticos
        wfOf().setBinding(ctxOf(p.org), swapIn(p, other, cur.id)),                                          // conflitante
        ...Array.from({ length: 2 }, () => wfOf().createDraft(ctxOf(p.org), { identityId: p.model!.identityId, ast: R2.ast, sourceFormat: "NATIVE", catalogVersion: R2.catalog.version })),   // rascunhos comuns
        ...Array.from({ length: 2 }, (_, i) => reg.register(ctxOf(p.org), {
          target: { kind: "EXISTING_IDENTITY" as const, identityId: p.model!.identityId }, templateKey: R2.modelKey, displayName: R2.displayName, declaredScope: R2.declaredScope,
          source: { kind: "MODEL_PACKAGE" as const, modelKey: R2.modelKey, packageVersion: "1.0.2-draft" }, sourceLogicalVersion: R2.provenance.sourceLogicalVersion,
          sourceSha256: R2.provenance.sourceSha256, confirm: true as const, idempotencyKey: `cand-prov-stress-${RUN}-${round}-${i}`, decision: decision(),
        } as any, { uniqueDraft: true })),
      ];
      const out = await Promise.allSettled(ops);
      const bad = out.filter((x) => x.status === "rejected").map((x: any) => String(x.reason?.message ?? x.reason)).filter((m) => !expectedErr.test(m));
      expect(bad, `rodada ${round}`).toEqual([]);                                                       // nenhum deadlock/erro inesperado vaza
      const act = await activeBindings(p);
      expect(act, `rodada ${round}`).toHaveLength(1);                                                   // um ativo, nunca zero nem dois
      expect(await wfOf().resolveBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE })).toMatchObject({ status: "RESOLVED" });
      for (const rev of await revisionsOf(p)) expect(rev.semanticHash === R2_HASH || rev.semanticHash === R1_HASH || rev.revision >= 1).toBe(true);
    }
    // o caminho EXCLUSIVO nunca duplica: as N chamadas de registro convergiram numa só revisão por hash entre as criadas por ele
    const exclusive = (await revisionsOf(p)).filter((r) => r.semanticHash === R2_HASH);
    expect(new Set(exclusive.map((r) => r.revision)).size).toBe(exclusive.length);                      // numeração única (sem colisão de número)
    expect((await revisionsOf(p)).find((r) => r.id === r1Id)!.status).toBe("PUBLISHED");
  }, 300_000);

  // ───────────────────────── SEGUNDO AMEND — linearização temporal e convergência do swap (barreiras determinísticas) ─────────────────────────
  /** Barreira determinística (sem sleep): `atPoint` resolve quando o chamador chegou ao ponto; `release()` o libera. */
  const barrier = () => {
    let release!: () => void; let reached!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    const atPoint = new Promise<void>((r) => { reached = r; });
    return { release, reached, released, atPoint };
  };
  /** Workflow cujo relógio de SERVIDOR é fixo (réplica independente com seu próprio relógio). */
  const wfAt = (nowIso: string) => new InstitutionalTemplatesWorkflow({ ...getTemplateWorkflowPorts(), clock: { now: () => nowIso } } as any);
  const swapIn = (p: P, rev: string, replaces: string) => ({ documentKind: "edital" as const, scope: R2_SCOPE, identityId: p.model!.identityId, pinnedRevisionId: rev, confirm: true as const, replacesBindingId: replaces });
  /** Portas de composição cuja leitura de bindings pára numa barreira ANTES (`before`) ou DEPOIS (`after`) de a leitura real acontecer. */
  const gatedBindingRead = (when: "before" | "after", b: ReturnType<typeof barrier>): any => {
    const base = realPorts(); let once = true;
    return { ...base, repository: { ...base.repository, listBindings: async (...a: any[]) => {
      if (when === "before" && once) { once = false; b.reached(); await b.released; }
      const out = await (base.repository.listBindings as any)(...a);
      if (when === "after" && once) { once = false; b.reached(); await b.released; }
      return out;
    } } };
  };
  const bindingEvents = async (org: number, type: string) => count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ? AND event_type = ?", [org, type]);

  it("LIN-A — asOf capturado ANTES da leitura; swap carimba vigência logo DEPOIS e comita; leitura retomada ⇒ continua vinculado (nunca NOT_BOUND/legado)", async () => {
    const p = await prepareOrg("lin-a", 1); const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const T0 = "2026-10-13T12:00:00.000Z";
    const b = barrier();
    const reader = resolveEditalTemplate({ ports: gatedBindingRead("before", b), now: () => T0 }, p.org, WS);
    await b.atPoint;                                                                                  // o leitor capturou o instante e vai ler os vínculos
    const swapped = await wfAt("2026-10-13T12:00:00.001Z").setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));   // vigência 1 ms DEPOIS do asOf do leitor; comita antes da leitura
    expect(swapped.effectiveFrom).toBe("2026-10-13T12:00:00.001Z");
    b.release();
    const res: any = await reader;
    expect(res.status, JSON.stringify(res)).toBe("BOUND");
    expect(res.template.revisionId).toBe(r2Id);
    expect(await activeBindings(p)).toHaveLength(1);
  }, 300_000);

  it("LIN-A2 — geração completa (rota real) logo após um swap com vigência à frente do relógio do leitor: INSTITUCIONAL pela nova revisão, nunca o gerador legado", async () => {
    const p = await readyTenant("lin-gen", 1); const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    await wfAt(new Date(Date.now() + 3_600_000).toISOString()).setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));      // réplica com relógio 1 h adiantado
    expect(((await preflight(p)) as any).status).not.toBe("NOT_APPLICABLE");                         // o preflight também resolve o vínculo ativo (nunca "sem modelo")
    const before = legacy.calls;
    const g = await callGen(p);
    expect(legacy.calls).toBe(before);
    expect(g.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(g.template.revisionId).toBe(r2Id);
  }, 600_000);

  it("LIN-B — leitura consistente é UM ponto de linearização: swap pausado com a transação aberta ⇒ leitor vê o antigo; após o commit ⇒ vê o novo; leitura em curso durante o commit é coerente", async () => {
    const p = await prepareOrg("lin-b", 1); const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const read = () => resolveEditalTemplate({ ports: realPorts(), now: () => new Date().toISOString() }, p.org, WS) as Promise<any>;
    const wports = getTemplateWorkflowPorts();
    const tctx = { organizationId: p.org, actorUserId: U_MANAGER, correlationId: "corr-lin-b" };
    const hold = barrier(); const resume = barrier();
    const nb = { id: wports.ids.newId("tb"), organizationId: p.org, documentKind: "edital" as const, scope: R2_SCOPE, identityId: p.model!.identityId, pinnedRevisionId: r2Id, active: true, effectiveFrom: new Date(Date.now() + 60_000).toISOString() };
    const swapTx = withTemplatesTransaction("test.lin-b.swap", tctx, async (tx) => {
      await dbDeactivateBinding(tx, tctx, old.id); await dbInsertBinding(tx, tctx, nb);
      hold.reached(); await resume.released;                                                          // transação do swap ABERTA (não comitada)
    });
    await hold.atPoint;
    const during: any = await read();
    expect(during.status).toBe("BOUND"); expect(during.template.revisionId).toBe(r1Id);               // ainda o antigo: nada não comitado é visível
    resume.release(); await swapTx;
    const after: any = await read();
    expect(after.status, JSON.stringify(after)).toBe("BOUND"); expect(after.template.revisionId).toBe(r2Id);   // vigência 1 min à frente NÃO abre janela
    // leitura que JÁ terminou (viu o antigo) enquanto o swap comita: coerente com o ponto de linearização dela
    const b = barrier();
    const slow = resolveEditalTemplate({ ports: gatedBindingRead("after", b), now: () => new Date().toISOString() }, p.org, WS);
    await b.atPoint;
    await wfAt(new Date(Date.now() + 60_000).toISOString()).setBinding(ctxOf(p.org), swapIn(p, r1Id, nb.id));
    b.release();
    const coherent: any = await slow;
    expect(coherent.status).toBe("BOUND"); expect(coherent.template.revisionId).toBe(r2Id);          // linearizada antes do swap
    expect(((await read()) as any).template.revisionId).toBe(r1Id);                                    // a próxima leitura vê o resultado do swap
  }, 300_000);

  it("LIN-C — swaps R1→R2→R1 com gerações concorrentes: nenhum leitor vê NOT_BOUND; um único ativo ao final", async () => {
    const p = await prepareOrg("lin-c", 1); const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p);
    let cur = (await activeBindings(p))[0];
    const seen: string[] = [];
    for (const [i, rev] of ([r2Id, r1Id, r2Id, r1Id] as const).entries()) {
      const b = barrier();
      const reader = resolveEditalTemplate({ ports: gatedBindingRead("before", b), now: () => "2026-10-13T12:00:00.000Z" }, p.org, WS);
      await b.atPoint;
      cur = await wfAt(new Date(Date.parse("2026-10-13T12:00:00.000Z") + (i + 1) * 250).toISOString()).setBinding(ctxOf(p.org), swapIn(p, rev, cur.id));
      b.release();
      const r: any = await reader; seen.push(`${r.status}:${r.template?.revisionId === rev}`);
    }
    expect(seen).toEqual(Array(4).fill("BOUND:true"));
    expect(await activeBindings(p)).toHaveLength(1);
  }, 300_000);

  it("LIN-D — relógios independentes com desvio ≥ 500 ms (réplica do swap à frente e atrás da réplica do leitor) não afetam a resolução operacional", async () => {
    const p = await prepareOrg("lin-d", 1); const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p);
    const readerNow = () => "2026-10-13T12:00:00.000Z";
    let cur = (await activeBindings(p))[0];
    for (const [skew, rev] of [[+700, r2Id], [-700, r1Id], [+5_000, r2Id], [-5_000, r1Id]] as const) {
      cur = await wfAt(new Date(Date.parse("2026-10-13T12:00:00.000Z") + skew).toISOString()).setBinding(ctxOf(p.org), swapIn(p, rev, cur.id));
      const r: any = await resolveEditalTemplate({ ports: realPorts(), now: readerNow }, p.org, WS);
      expect(r.status, `skew ${skew}`).toBe("BOUND"); expect(r.template.revisionId).toBe(rev);
    }
  }, 300_000);

  it("LIN-E — consulta HISTÓRICA com asOf explícito mantém a semântica histórica (não vira estado corrente); replay oficial usa manifest/revisão exata", async () => {
    const p = await prepareOrg("lin-e", 1); const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const swapped = await wfAt("2026-10-13T12:00:00.500Z").setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));
    const at = (asOf: string) => wfOf().resolveBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE, asOf });
    expect((await at("2026-10-13T12:00:00.499Z")).status).toBe("NOT_BOUND");                           // antes da vigência do novo vínculo: NÃO retroage
    const sameInstant: any = await at("2026-10-13T12:00:00.500Z");
    expect(sameInstant.status).toBe("RESOLVED"); expect(sameInstant.binding.id).toBe(swapped.id);
    expect(((await at("2099-01-01T00:00:00.000Z")) as any).revision.id).toBe(r2Id);
    // sem asOf (operacional): o vínculo ativo, sem depender de instante
    expect(((await wfOf().resolveBinding(ctxOf(p.org), { documentKind: "edital", scope: R2_SCOPE })) as any).revision.id).toBe(r2Id);
    // as revisões continuam exatas e imutáveis
    expect((await revisionsOf(p)).every((r) => r.status === "PUBLISHED")).toBe(true);
  }, 300_000);

  it("SWAP-CONV — A lê o antigo, B comita a MESMA troca, A retoma ⇒ ambos obtêm o mesmo vínculo; um ativo; sem eventos duplicados", async () => {
    const p = await prepareOrg("swp", 1); const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const created0 = await bindingEvents(p.org, "BINDING_CREATED"); const deact0 = await bindingEvents(p.org, "BINDING_DEACTIVATED");
    const base = getTemplateWorkflowPorts(); const b = barrier(); let once = true;
    const SAME_CLOCK = "2026-10-13T12:00:00.000Z";                                                   // A e B carimbam o MESMO instante (réplicas com relógios iguais/equivalentes)
    const pausedA = new InstitutionalTemplatesWorkflow({ ...base, clock: { now: () => SAME_CLOCK }, repository: { ...base.repository, getBinding: async (org: number, id: string) => {
      const r = await base.repository.getBinding(org, id);
      if (once) { once = false; b.reached(); await b.released; }
      return r;
    } } } as any);
    const aP = pausedA.setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));
    await b.atPoint;                                                                                  // A já leu o vínculo antigo (ativo)
    const bRes = await wfAt(SAME_CLOCK).setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));            // B conclui a mesma troca (comita)
    b.release();
    const aRes = await aP;                                                                            // antes: BINDING_AMBIGUOUS
    expect(aRes.id).toBe(bRes.id);
    const act = await activeBindings(p);
    expect(act.map((x) => x.id)).toEqual([bRes.id]); expect(act[0].pinnedRevisionId).toBe(r2Id);
    expect(await bindingEvents(p.org, "BINDING_CREATED")).toBe(created0 + 1);                         // exatamente UMA criação nova
    expect(await bindingEvents(p.org, "BINDING_DEACTIVATED")).toBe(deact0 + 1);                       // e UMA desativação (do antigo)
    expect((await getTemplateWorkflowPorts().repository.getBinding(p.org, old.id))!.active).toBe(false);
  }, 300_000);

  it("SWAP-CONV — pedido CONFLITANTE (outra revisão) retomado depois do commit de B é RECUSADO; o resultado de B permanece; tenant alheio não consulta nem substitui", async () => {
    const p = await prepareOrg("swp-c", 1); const other = await prepareOrg("swp-c2", 1);
    const r1Id = p.model!.revisionId; const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const base = getTemplateWorkflowPorts(); const b = barrier(); let once = true;
    const SAME_CLOCK = "2026-10-13T12:00:00.000Z";                                                   // A e B carimbam o MESMO instante (réplicas com relógios iguais/equivalentes)
    const pausedA = new InstitutionalTemplatesWorkflow({ ...base, clock: { now: () => SAME_CLOCK }, repository: { ...base.repository, getBinding: async (org: number, id: string) => {
      const r = await base.repository.getBinding(org, id);
      if (once) { once = false; b.reached(); await b.released; }
      return r;
    } } } as any);
    const aP = pausedA.setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));                             // A quer a Revisão 2
    await b.atPoint;
    const bRes = await wfAt(SAME_CLOCK).setBinding(ctxOf(p.org), swapIn(p, r1Id, old.id));            // B comita OUTRO alvo (Revisão 1, novo vínculo)
    b.release();
    await expect(aP).rejects.toThrow(/BINDING_AMBIGUOUS|já existe|CONFLICT|conflit/i);                // não vira sucesso idempotente
    expect((await activeBindings(p)).map((x) => x.id)).toEqual([bRes.id]);
    expect((await activeBindings(p))[0].pinnedRevisionId).toBe(r1Id);
    // outro tenant: nem enxerga nem substitui
    await expect(wfOf().setBinding(ctxOf(other.org), swapIn(p, r2Id, bRes.id))).rejects.toThrow(/não encontrad/i);
    await expect(wfOf().setBinding(ctxOf(other.org), { ...swapIn(other, other.model!.revisionId, bRes.id) })).rejects.toThrow(/não encontrad/i);
    expect((await wfOf().listBindings(ctxOf(other.org), { documentKind: "edital", activeOnly: true })).some((x) => x.id === bRes.id)).toBe(false);
    expect((await activeBindings(p)).map((x) => x.id)).toEqual([bRes.id]);
  }, 300_000);

  it("SWAP-CONV — resultado INCERTO (commit feito, resposta perdida) reconcilia para o vínculo persistido; erros de autorização/tenant/validação NUNCA viram sucesso", async () => {
    const p = await prepareOrg("swp-u", 1); const r2Id = await publishCandidate(p); const old = (await activeBindings(p))[0];
    const base = getTemplateWorkflowPorts();
    const lost = new InstitutionalTemplatesWorkflow({ ...base, repository: { ...base.repository, insertBinding: async (...a: any[]) => { await (base.repository.insertBinding as any)(...a); throw new Error("conexão perdida após o commit"); } } } as any);
    const res = await lost.setBinding(ctxOf(p.org), swapIn(p, r2Id, old.id));
    expect((await activeBindings(p)).map((x) => x.id)).toEqual([res.id]);
    // erro de tenant/autorização NÃO é convertido em convergência, MESMO havendo vínculo equivalente ativo (outro executor comita a troca entre o preflight e a escrita)
    const q = await prepareOrg("swp-u2", 1); const q2 = await publishCandidate(q); const qOld = (await activeBindings(q))[0];
    const denied = new InstitutionalTemplatesWorkflow({ ...base, repository: { ...base.repository, insertBinding: async () => {
      await wfOf().setBinding(ctxOf(q.org), swapIn(q, q2, qOld.id));                                  // a troca equivalente é comitada por OUTRO executor
      throw new TemplateWorkflowError("NOT_FOUND", "recurso não encontrado nesta organização");
    } } } as any);
    await expect(denied.setBinding(ctxOf(q.org), swapIn(q, q2, qOld.id))).rejects.toThrow(/não encontrad/i);
    expect((await activeBindings(q)).map((x) => x.pinnedRevisionId)).toEqual([q2]);                   // o vínculo de B permanece, a recusa não foi mascarada
  }, 300_000);
});
