/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PILOTO DO EDITAL — E2E INTEGRADO (Lanes A + B + C) contra MySQL REAL. Dados 100% SINTÉTICOS (órgãos 98xxxxxxx, processo, itens,
 * TR e narrativas fictícios); nada de produção, nenhum modelo cadastrado fora do banco local, flag OFF fora destes órgãos.
 * Só roda com DATABASE_URL.
 *
 *  E1  FLUXO COMPLETO (orçamento PÚBLICO): pacote do modelo → identidade → DRAFT → evidência jurídica → APPROVED → prontidão READY →
 *      PUBLISHED → binding exato (edital/pregao/eletronica/bll) → ITEMS canônicos → TR por pin exato → campos governados → tpl-ast/2 →
 *      M1 → revisão humana (edição com linhagem + aceite EXATO das 3 narrativas de IA) → revalidação canônica → M2 → emissão oficial →
 *      DOCX/PDF reais; 0 placeholder · 0 SYSTEM NOTE · 0 marcador pendente · 0 xref quebrada; valores e "(R$)" preservados
 *  E2  SIGILOSO: nenhum valor monetário estimado em texto, tabela, anexo, título, metadados nem manifest
 *  E3  REGRAS governadas: maior desconto + orçamento sigiloso ⇒ composição BLOQUEADA (MODEL_RULE_VIOLATED); cenário com autoridade
 *      indisponível ⇒ RULE_VALIDATION_UNAVAILABLE (fail-closed)
 *  E4  REPLAY: mesmo comando de geração ⇒ mesmo M1, sem versão duplicada; mesma publicação ⇒ mesma decisão, sem evento duplicado
 *  E5  CONCORRÊNCIA: publicação concorrente ⇒ exatamente uma transição; mesmo binding ⇒ exatamente um ativo; plataforma/forma diferentes coexistem
 *  E6  SOURCE_CHANGED entre M1 e M2: TR novo ou campo governado alterado ⇒ emissão BLOQUEADA, zero mutação oficial
 *  E7  CROSS-TENANT adversarial: o órgão B nunca usa identidade, revisão, binding, ITEMS, TR, campos governados nem evidência do A
 *  E8  TPL-ED-PUB-TOCTOU-001: evidência/procedência superada entre a prontidão e o COMMIT ⇒ READINESS_STALE + rollback total
 *  E9  MULTI-MODELO: um segundo modelo SINTÉTICO (Pregão Presencial) coexiste com o BLL pelo MESMO composer, sem engine novo
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema, collectSchemaProblems } from "../../bootstrap";
import { checkForeignKeyContract } from "../../db/schemaForeignKeyGuard";
import { draftContentHash } from "../../domain/generatedDocument";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { saveReviewableDraft } from "../../services/procurementProcessService";
import { generateTemplatedDocument, type GenerateTemplatedDocumentParams } from "../../services/institutionalTemplates/templateCompositionService";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { TemplateReadinessService, createTemplateReadinessPort } from "../../services/institutionalTemplates/readinessService";
import { TemplateReviewService } from "../../services/institutionalTemplates/reviewService";
import { readGovernedRecord, GOVERNED_ORG_SUBJECT } from "../../services/institutionalTemplates/governedFieldsStore";
import { GovernedSourceService } from "../../services/institutionalTemplates/governedSourceService";
import { createVariableCatalogPort } from "../../services/institutionalTemplates/catalogRegistry";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts, templateIssuanceHook } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateCompositionPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { buildInstitutionalModel, renderInstitutionalDOCX, renderInstitutionalPDF } from "../../services/documentConverter";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { readZipEntry } from "../helpers/zipText";
import type { TemplateAST2, VariableCatalog2 } from "../../domain/institutionalTemplates";
import {
  BLL, BLL_CATALOG, E2E_SCENARIO, U_AUTHOR, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, governedFieldsFor, seedAiExecution,
  seedGoverned, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 981_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-e2e`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const err = async (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);

const SLOTS = {
  "justificativa-vedacao-subcontratacao": "A vedação à subcontratação decorre da natureza do objeto e do controle de qualidade pretendido.",
  "obrigacoes-especificas-contratado": "Entregar os bens conforme o Termo de Referência e substituir o que estiver em desconformidade.",
  "obrigacoes-especificas-contratante": "Fiscalizar a execução, atestar os recebimentos e efetuar o pagamento nas condições pactuadas.",
} as const;

interface Prepared { w: World; tr: { documentId: string; version: number; contentHash: string }; identityId: string; revisionId: string; execIds: string[] }

/** Registra o pacote BLL → evidência jurídica → APPROVED → PUBLISHED (decisões humanas distintas) para o órgão. */
async function publishBll(org: number, opts: { bind?: boolean; stopAt?: "APPROVED" } = {}): Promise<{ identityId: string; revisionId: string; bindingId: string | null; keys: { pb: string; ev: string } }> {
  const wports = getTemplateWorkflowPorts();
  const keys = { pb: key("pb"), ev: key("ev") };
  const reg = await new ModelRegistrationService(wports).register(ctxOf(org), {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: BLL.slug }, templateKey: BLL.modelKey, displayName: BLL.displayName,
    declaredScope: BLL.declaredScope, source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey },
    sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256,
    confirm: true, idempotencyKey: key("reg"), decision: decision(),
  });
  expect(reg.revision.status).toBe("DRAFT");
  expect(reg.provenance.status).toBe("RECORDED");
  await new TemplateGovernanceService(wports).recordLegalEvidence(ctxOf(org), {
    revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: keys.ev, decision: decision({ basisReference: "Parecer jurídico — [preencher no piloto]" }),
    evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 },
  });
  const wf = new InstitutionalTemplatesWorkflow(wports);
  await wf.approve(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision({ basisReference: "Ato de aprovação" }) });
  if (opts.stopAt === "APPROVED") return { identityId: reg.identity.id, revisionId: reg.revision.id, bindingId: null, keys };
  await wf.publish(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: keys.pb, decision: decision({ basisReference: "Ato de publicação" }) });
  let bindingId: string | null = null;
  if (opts.bind !== false) {
    const b = await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
    bindingId = b.id;
  }
  return { identityId: reg.identity.id, revisionId: reg.revision.id, bindingId, keys };
}

async function prepare(label: string, over: { scenario?: Record<string, unknown>; disclosure?: "publico" | "sigiloso"; flagOn?: boolean } = {}): Promise<Prepared & { bindingId: string | null }> {
  const org = newOrg();
  const w = await seedWorld(conn, org, label, { flagOn: over.flagOn });
  await seedGoverned(w, { ...E2E_SCENARIO, ...(over.scenario ?? {}) } as any, over.disclosure ?? "publico", label);
  const tr = await seedOfficialTr(conn, w);
  const exec = await Promise.all(Object.entries(SLOTS).map(([slot, text]) => seedAiExecution(conn, org, slot, text)));
  const m = await publishBll(org);
  return { w, tr, identityId: m.identityId, revisionId: m.revisionId, bindingId: m.bindingId, execIds: exec };
}

const genParams = async (p: Prepared, over: Partial<GenerateTemplatedDocumentParams> = {}): Promise<GenerateTemplatedDocumentParams> => {
  const ports = getTemplateCompositionPorts();
  return {
    organizationId: p.w.org, subjectId: p.w.processId, documentKind: "edital", documentType: "edital", scope: { ...BLL.declaredScope },
    asOf: "2026-10-07T00:00:00Z", title: "Edital de Pregão Eletrônico — sintético", actorUserId: U_AUTHOR, correlationId: `corr-gen-${p.w.org}`,
    aiNarratives: [...(await ports.review.loadAiOutputs(p.w.org, p.execIds))],
    officialPins: { TR: { documentId: p.tr.documentId, version: p.tr.version, contentHash: p.tr.contentHash } }, ...over,
  };
};
const generate = async (p: Prepared, over: Partial<GenerateTemplatedDocumentParams> = {}) =>
  generateTemplatedDocument(await genParams(p, over), getTemplateCompositionPorts());

const draftOf = async (w: World) => (await rows("SELECT * FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [w.org, w.processId]))[0];
const accept = async (p: Prepared, manifestId: string, narrative: { slotKey: string; executionId: string; outputHash: string }) =>
  new TemplateReviewService(getTemplateWorkflowPorts().manifests!).acceptAiNarrative(ctxOf(p.w.org), {
    manifestId, ...narrative, confirm: true, idempotencyKey: key(`acc-${narrative.slotKey}`).slice(0, 120), decision: decision({ basisReference: "Revisão do documento composto" }),
  });
const promote = (p: Prepared, content: string, idem: string, actor = U_MANAGER) => promoteOfficialDocument({
  organizationId: p.w.org, processId: p.w.processId, kind: "edital", actorUserId: actor, actorRole: "manager", idempotencyKey: idem,
  correlationId: `corr-promo-${p.w.org}`, expectedContentHash: draftContentHash(content), reason: "Revisado e conferido pelo gestor.", templateIssuance: templateIssuanceHook(),
});

/** Revisão humana completa: edição com linhagem (editor ≠ autor) + aceite EXATO de cada narrativa de IA. Devolve o conteúdo a emitir. */
async function humanReview(p: Prepared, g: Awaited<ReturnType<typeof generate>>): Promise<string> {
  const d = await draftOf(p.w);
  const content = `${d.content}\nObservação do revisor: conteúdo conferido.\n`;
  await saveReviewableDraft({
    organizationId: p.w.org, processId: p.w.processId, kind: "edital", content, actorUserId: U_EDITOR,
    expectedContentHash: draftContentHash(d.content), idempotencyKey: key("edit"), correlationId: "corr-edit",
  });
  for (const n of g.generationManifest.aiNarratives) await accept(p, g.generationManifest.id, n);
  return content;
}

const NO_RESIDUE = (text: string) => {
  expect(text, "placeholder {{ }}").not.toMatch(/\{\{|\}\}/);
  expect(text, "SYSTEM NOTE").not.toMatch(/SYSTEM NOTE/i);
  expect(text, "marcador pendente").not.toMatch(/\[REVISAR/);
  expect(text, "xref quebrada").not.toMatch(/⟦|⟧|\[XREF|xref:/);
};

describe.skipIf(!DB)("Piloto Edital — E2E integrado A+B+C (MySQL real, dados sintéticos)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    // NORMATIVE: gate do reference set GOVERNADO (a fonte normativa só existe com set ativo, aprovado e íntegro)
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "e2e-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) {
      for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    }
    await conn.end();
  }, 120_000);

  it("E1 — fluxo completo com orçamento PÚBLICO: do pacote do modelo à emissão oficial + DOCX/PDF", async () => {
    const p = await prepare("e1");
    const wports = getTemplateWorkflowPorts();

    // modelo: identidade com displayName, revisão PUBLISHED exata, decisões distintas, evidência jurídica separada
    const ident = (await rows("SELECT slug, display_name d, document_kind k FROM institutional_template_identities WHERE organization_id = ? AND id = ?", [p.w.org, p.identityId]))[0];
    expect(ident).toMatchObject({ slug: "edital-pregao-eletronico-bll", d: "Edital — Pregão Eletrônico — BLL", k: "edital" });
    const rev = (await rows("SELECT status, variable_catalog_version v, approval_decision_id a, publish_decision_id b, ast_json FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [p.w.org, p.revisionId]))[0];
    expect(rev).toMatchObject({ status: "PUBLISHED", v: BLL_CATALOG.version });
    expect(rev.a).not.toBe(rev.b);
    expect(JSON.parse(rev.ast_json).schema).toBe("tpl-ast/2");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_legal_approval_evidence'", [p.w.org])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type IN ('template_approval','template_publication')", [p.w.org])).toBe(2);
    // prontidão real: READY, com a testemunha do estado provado
    const ready = (await new TemplateReadinessService(wports).evaluate(ctxOf(p.w.org), { revisionId: p.revisionId })).matrix;
    expect(ready.overall).toBe("READY");
    expect(ready.checks).toHaveLength(12);
    expect(ready.witness.revisionSemanticHash).toBe(rev ? (await rows("SELECT semantic_hash h FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [p.w.org, p.revisionId]))[0].h : "");
    // binding exato edital/pregao/eletronica/bll
    const b = (await rows("SELECT scope_modality m, scope_form f, scope_platform pl, scope_regime r, scope_criterion c FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [p.w.org]));
    expect(b).toEqual([{ m: "pregao", f: "eletronica", pl: "bll", r: "", c: "" }]);

    // M1 (tpl-ast/2) — TR por pin exato, ITEMS canônicos, campos governados
    const g = await generate(p);
    expect(g.replayed).toBe(false);
    expect(g.generationManifest.templateRevisionId).toBe(p.revisionId);
    const text = g.content;
    NO_RESIDUE(text);
    expect(text).toContain("Preço unitário (R$)");
    expect(text).toContain("Preço total (R$)");
    expect(text).toContain("R$ 25,50");           // valor unitário canônico (orçamento público)
    expect(text).toContain("R$ 3.060,00");        // 120 × 25,50
    expect(text).toContain("R$ 3.760,00");        // valor estimado global (3.060,00 + 700,00)
    expect(text).toContain("Papel sulfite A4 75g");
    expect(text).toContain("120");                // quantidade = plannedQuantity canônica
    expect(g.generationManifest.officialDocRefs?.[0]).toMatchObject({ role: "termo-referencia", documentId: p.tr.documentId, version: 1, contentHash: p.tr.contentHash });   // TR por pin EXATO
    // pós-homologação: nunca inventado
    expect(text).toContain("a preencher");
    expect(g.generationManifest.aiNarratives.map((n) => n.slotKey).sort()).toEqual(Object.keys(SLOTS).sort());

    // revisão humana + revalidação canônica + M2 + emissão
    const content = await humanReview(p, g);
    const r = await promote(p, content, key("promo"));
    expect(r.promoted).toBe(true);
    expect(r.officialDocument.status).toBe("emitido");
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.w.org])).toBe(1);
    const official = (await rows("SELECT content, title, metadata FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [p.w.org]))[0];
    NO_RESIDUE(official.content);

    // DOCX/PDF reais
    const model = buildInstitutionalModel(official.content, { documentTitle: "Edital de Pregão Eletrônico — sintético", statusLabel: "EMITIDO", isDraft: false, version: 1, exportedAtLabel: "07/10/2026" });
    const tables = model.blocks.filter((x: any) => x.kind === "table").length;
    expect(tables).toBeGreaterThanOrEqual(5);
    const docx = await renderInstitutionalDOCX(model);
    const xml = readZipEntry(docx, "word/document.xml") ?? "";
    expect(xml.split("<w:tbl>").length - 1).toBe(tables);
    expect(xml).not.toContain("<m:oMath");
    const plain = xml.replace(/<[^>]+>/g, "|");
    for (const f of ["Preço unitário (R$)", "Preço total (R$)", "R$ 25,50", "R$ 3.760,00"]) expect(plain, f).toContain(f);
    expect((await renderInstitutionalPDF(model)).subarray(0, 4).toString()).toBe("%PDF");
    // sanidade estrutural: seções, anexos em ordem, numeração determinística (duas composições idênticas ⇒ mesmo texto)
    const idx = ["ANEXO I", "ANEXO II", "ANEXO III", "ANEXO IV"].map((a) => text.indexOf(`## ${a}`));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);

    expect(await checkForeignKeyContract(conn)).toEqual([]);
    expect(await collectSchemaProblems(conn)).toEqual([]);
  }, 300_000);

  /** Texto/manifest/metadados de um órgão com orçamento SIGILOSO nunca contêm valor estimado. */
  const LEAKS = ["25,50", "1,75", "3.060,00", "700,00", "3.760,00", "2550", "306000", "37600", "175"];
  const noMoney = (label: string, s: string) => {
    expect(s, `${label}: valor monetário`).not.toMatch(/R\$\s?\d/);
    for (const v of LEAKS) expect(s, `${label}: ${v}`).not.toContain(v);
  };

  it("E2 — orçamento SIGILOSO: nenhum valor estimado em texto, tabela, anexo, título, metadados nem manifest", async () => {
    const p = await prepare("e2", { disclosure: "sigiloso" });
    const g = await generate(p);
    NO_RESIDUE(g.content);
    noMoney("M1 texto", g.content);
    expect(g.content).not.toContain("Valor unitário estimado");   // coluna condicional some
    expect(g.content).toContain("Preço unitário (R$)");           // cabeçalho do modelo de proposta (sem valores)
    noMoney("manifest", JSON.stringify(g.generationManifest));
    const content = await humanReview(p, g);
    await promote(p, content, key("promo"));
    const official = (await rows("SELECT content, title, metadata FROM official_documents WHERE tenant_id = ? AND document_type = 'edital'", [p.w.org]));
    for (const r of official) { noMoney("oficial.content", r.content); noMoney("oficial.title", r.title); noMoney("oficial.metadata", JSON.stringify(r.metadata)); }
    noMoney("manifests", JSON.stringify(await rows("SELECT * FROM document_composition_manifests WHERE organization_id = ?", [p.w.org])));
    noMoney("draft", JSON.stringify(await rows("SELECT title, content FROM generated_documents WHERE organization_id = ?", [p.w.org])));
    const model = buildInstitutionalModel(official.find((r) => r.content)!.content, { documentTitle: "Edital sigiloso", statusLabel: "EMITIDO", isDraft: false, version: 1, exportedAtLabel: "07/10/2026" });
    const xml = (readZipEntry(await renderInstitutionalDOCX(model), "word/document.xml") ?? "").replace(/<[^>]+>/g, "|");
    noMoney("docx", xml);
  }, 300_000);

  it("E3 — regras governadas: maior desconto + sigilo ⇒ MODEL_RULE_VIOLATED; autoridade indisponível com cenário ativo ⇒ RULE_VALIDATION_UNAVAILABLE", async () => {
    const a = await prepare("e3a", { disclosure: "sigiloso", scenario: { "julgamento.criterioJulgamento": "maior desconto" } });
    const before = await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [a.w.org]);
    expect((await err(generate(a)))?.message).toMatch(/MODEL_RULE_VIOLATED/);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [a.w.org])).toBe(before);   // zero M1
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ?", [a.w.org])).toBe(0);                   // zero rascunho
    const b = await prepare("e3b", { scenario: { "decisao.exigeGarantiaContratual": true, "contratacao.percentualGarantiaContratual": 8 } });
    expect((await err(generate(b)))?.message).toMatch(/RULE_VALIDATION_UNAVAILABLE/);
    const c = await prepare("e3c", { scenario: { "decisao.exigeGarantiaContratual": true, "contratacao.percentualGarantiaContratual": 12 } });
    expect((await err(generate(c)))?.message).toMatch(/MODEL_RULE_VIOLATED/);
    const d = await prepare("e3d", { scenario: { "instituicao.canalEsclarecimentos": "licitacao@exemplo.gov.br ou protocolo físico" } });
    expect((await err(generate(d)))?.message).toMatch(/MODEL_RULE_VIOLATED/);
  }, 300_000);

  it("E4 — replay: mesma geração ⇒ mesmo M1 sem versão duplicada; mesma publicação ⇒ mesma decisão, sem evento duplicado", async () => {
    const p = await prepare("e4");
    const g1 = await generate(p);
    const g2 = await generate(p);
    expect(g2.replayed).toBe(true);
    expect(g2.generationManifest.id).toBe(g1.generationManifest.id);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [p.w.org])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'gerado'", [p.w.org])).toBe(1);
    // publicação: mesma chave + mesmo pedido ⇒ replayed, sem decisão/evento novos
    const decisions = await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [p.w.org]);
    const events = await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [p.w.org]);
    const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
    const again = await wf.publish(ctxOf(p.w.org), { revisionId: p.revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: (await rows("SELECT idempotency_key k FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [p.w.org]))[0].k, decision: decision({ basisReference: "Ato de publicação" }) });
    expect((again as any).replayed).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [p.w.org])).toBe(decisions);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [p.w.org])).toBe(events);
  }, 300_000);

  it("E5 — concorrência: publicação ⇒ exatamente uma transição; mesmo binding ⇒ exatamente um ativo; forma/plataforma diferentes coexistem", async () => {
    const org = newOrg();
    await seedWorld(conn, org, "e5");
    const m = await publishBll(org, { stopAt: "APPROVED" });
    const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
    const res = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => wf.publish(ctxOf(org), { revisionId: m.revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key(`cpb${i}`), decision: decision({ basisReference: `Ato ${i}` }) })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [org])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ? AND event_type LIKE '%PUBLISH%'", [org])).toBeLessThanOrEqual(1);
    const bind = (scope: Record<string, string>) => wf.setBinding(ctxOf(org), { documentKind: "edital", scope, identityId: m.identityId, pinnedRevisionId: m.revisionId, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
    const same = await Promise.allSettled(Array.from({ length: 6 }, () => bind({ ...BLL.declaredScope })));
    expect(same.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [org])).toBe(1);
    await bind({ ...BLL.declaredScope, platform: "licitanet" });
    await bind({ modality: "pregao", form: "presencial" });
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [org])).toBe(3);
  }, 300_000);

  it("E6 — SOURCE_CHANGED entre M1 e M2: TR novo ou campo governado alterado ⇒ emissão bloqueada, zero mutação oficial", async () => {
    const p = await prepare("e6a");
    const g = await generate(p);
    const content = await humanReview(p, g);
    await seedOfficialTr(conn, p.w, 2, "TERMO DE REFERÊNCIA — v2 alterado depois do M1");
    expect((await err(promote(p, content, key("promo"))))?.message).toMatch(/TEMPLATE_ISSUANCE_BLOCKED.*SOURCE_CHANGED/);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [p.w.org])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.w.org])).toBe(0);

    const q = await prepare("e6b");
    const g2 = await generate(q);
    const content2 = await humanReview(q, g2);
    const fields = governedFieldsFor("PROCESS", { ...E2E_SCENARIO, "processo.objetoResumido": "Objeto resumido ALTERADO depois do M1" } as any);
    const cur = (await rows("SELECT MAX(revision) r FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.source_fields'", [q.w.org]))[0].r;
    await new GovernedSourceService(createVariableCatalogPort()).recordProcessFields(ctxOf(q.w.org), {
      confirm: true, idempotencyKey: key("chg"), decision: decision(), catalogVersion: BLL_CATALOG.version, expectedRevision: Number(cur), processId: q.w.processId, source: "PROCESS", fields,
    });
    expect((await err(promote(q, content2, key("promo"))))?.message).toMatch(/TEMPLATE_ISSUANCE_BLOCKED.*SOURCE_CHANGED/);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [q.w.org])).toBe(0);
  }, 300_000);

  it("E7 — cross-tenant adversarial: o órgão B nunca usa identidade, revisão, binding, ITEMS, TR, campos governados nem evidência do A", async () => {
    const a = await prepare("e7a");
    const orgB = newOrg();
    const wb = await seedWorld(conn, orgB, "e7b");
    const wports = getTemplateWorkflowPorts();
    const wfB = new InstitutionalTemplatesWorkflow(wports);
    expect((await err(wfB.getRevision(ctxOf(orgB), a.revisionId)))?.code).toBe("NOT_FOUND");
    expect((await err(wfB.setBinding(ctxOf(orgB), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: a.identityId, pinnedRevisionId: a.revisionId, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true })))?.code).toBe("NOT_FOUND");
    expect((await err(new TemplateGovernanceService(wports).get(ctxOf(orgB), a.revisionId)))?.code).toBe("NOT_FOUND");
    expect((await err(new TemplateReadinessService(wports).evaluate(ctxOf(orgB), { revisionId: a.revisionId })))?.code).toBe("NOT_FOUND");
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ?", [orgB])).toBe(0);
    // geração do B: sem binding próprio ⇒ NOT_BOUND (o modelo do A não vaza)
    const pb: Prepared = { w: wb, tr: a.tr, identityId: "", revisionId: "", execIds: a.execIds };
    expect((await err(generate(pb)))?.message).toMatch(/TEMPLATE_NOT_BOUND/);
    // fontes canônicas: o processo do A não existe para o B (ITEMS/PROCESS/LIFECYCLE/BUDGET) e os campos governados do A não aparecem
    const ports = getTemplateCompositionPorts();
    for (const src of ["PROCESS", "ITEMS", "LIFECYCLE"] as const) expect((await err(ports.canonical.resolveSources(orgB, a.w.processId, [src], BLL_CATALOG)))?.reason, src).toMatch(/PROCESS_NOT_FOUND/);
    const leak = await ports.canonical.resolveSources(orgB, a.w.processId, ["CERTAME_CONFIG", "TR", "POLICY", "BUDGET"], BLL_CATALOG).catch(() => ({}));
    expect(Object.keys(leak)).toEqual([]);
    // campos governados do A: o B não grava no processo do A
    expect((await err(new GovernedSourceService(createVariableCatalogPort()).recordProcessFields(ctxOf(orgB), {
      confirm: true, idempotencyKey: key("x"), decision: decision(), catalogVersion: BLL_CATALOG.version, expectedRevision: 0, processId: a.w.processId, source: "CERTAME_CONFIG", fields: {},
    })))?.code).toBe("NOT_FOUND");
    // TR do A como pin do B (com binding próprio do B) ⇒ não encontrado
    await seedGoverned(wb, E2E_SCENARIO as any, "publico", "e7b");
    await publishBll(orgB);
    const exec = await Promise.all(Object.entries(SLOTS).map(([slot, text]) => seedAiExecution(conn, orgB, slot, text)));
    expect((await err(generate({ w: wb, tr: a.tr, identityId: "", revisionId: "", execIds: exec })))?.message).toMatch(/OFFICIAL_PIN_NOT_FOUND/);
    // os dados do A permanecem intactos
    expect((await generate(a)).replayed).toBe(false);
  }, 300_000);

  it("E8 — TPL-ED-PUB-TOCTOU-001: evidência superada entre a prontidão e o COMMIT ⇒ READINESS_STALE e rollback total; republicar converge", async () => {
    const org = newOrg();
    await seedWorld(conn, org, "e8");
    const m = await publishBll(org, { stopAt: "APPROVED" });
    const wports = getTemplateWorkflowPorts();
    const real = createTemplateReadinessPort(wports);
    const racing = {
      ...wports,
      readiness: {
        evaluateForPublication: async (c: any, i: any) => {
          const matrix = await real.evaluateForPublication(c, i);
          // "outra pessoa" registra nova evidência DEPOIS da avaliação e ANTES do commit
          await new TemplateGovernanceService(wports).recordLegalEvidence(ctxOf(org, 404), {
            revisionId: m.revisionId, expectedVersion: 1, confirm: true, idempotencyKey: key("ev2"), decision: decision({ basisReference: "Parecer complementar" }),
            evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 },
          });
          return matrix;
        },
      },
    };
    const counts = async () => [
      await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [org]),
      await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [org]),
    ];
    const before = await counts();
    const e = await err(new InstitutionalTemplatesWorkflow(racing as any).publish(ctxOf(org), { revisionId: m.revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pbr"), decision: decision({ basisReference: "Ato" }) }));
    expect(e?.code).toBe("READINESS_STALE");
    expect(await counts()).toEqual(before);
    expect((await rows("SELECT status FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, m.revisionId]))[0].status).toBe("APPROVED");
    const ok = await new InstitutionalTemplatesWorkflow(wports).publish(ctxOf(org), { revisionId: m.revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pbr2"), decision: decision({ basisReference: "Ato" }) });
    expect(ok.revision.status).toBe("PUBLISHED");
    expect((await counts())[0]).toBe(1);
  }, 300_000);

  it("E9 — multi-modelo: um segundo modelo SINTÉTICO (Pregão Presencial) coexiste com o BLL pelo MESMO composer; resolução exata; nenhum engine novo", async () => {
    const syn: VariableCatalog2 = {
      format: "tpl-catalog/2", version: "synthetic-edital-presencial/1",
      vars: [
        { name: "processo.numero", type: "string", source: "PROCESS", path: "numeroProcesso", required: true, renderable: true },
        { name: "orgao.nome", type: "string", source: "IDENTITY", path: "municipioNome", required: true, renderable: true },
        { name: "politica.canal", type: "string", source: "POLICY", path: "canal", required: true, renderable: true },
        { name: "itens.quadro", type: "table", source: "ITEMS", path: "quadroItensContratacao", required: true, renderable: true, columns: [
          { key: "item", type: "string", label: "Item" }, { key: "descricao", type: "text", label: "Descrição" }, { key: "unidade", type: "string", label: "Unidade" },
          { key: "quantidade", type: "number", label: "Quantidade" }, { key: "regimeParticipacao", type: "string", label: "Regime", required: false },
          { key: "codigoCatalogacao", type: "string", label: "Código", required: false }, { key: "valorUnitarioEstimado", type: "money", label: "Valor unitário", required: false },
          { key: "valorTotalEstimado", type: "money", label: "Valor total", required: false },
        ] },
      ],
    };
    const t = (v: string) => ({ t: "text", v }) as const;
    const ast: TemplateAST2 = { schema: "tpl-ast/2", root: [
      { t: "heading", level: 1, text: [t("Edital presencial nº "), { t: "var", name: "processo.numero" }] },
      { t: "paragraph", inline: [t("Órgão: "), { t: "var", name: "orgao.nome" }, t(" — canal: "), { t: "var", name: "politica.canal" }] },
      { t: "dataTable", tableKey: "itens", source: "itens.quadro", columns: [{ key: "item", header: [t("Item")] }, { key: "descricao", header: [t("Descrição")] }, { key: "quantidade", header: [t("Quantidade")] }] },
    ] };
    const base = createVariableCatalogPort();
    const catalog = { current: () => base.current(), byVersion: (v: string) => (v === syn.version ? syn : base.byVersion(v)) };
    const wp0 = { ...getTemplateWorkflowPorts(), catalog };
    const wp = { ...wp0, readiness: createTemplateReadinessPort(wp0 as any) }, cp = { ...getTemplateCompositionPorts(), catalog };

    const p = await prepare("e9");            // BLL publicado e vinculado (eletronica/bll)
    const org = p.w.org;
    // segundo modelo: MESMA trilha de registro → evidência → aprovação → publicação → binding exato
    const inv = { schema: "tpl-source-inventory/1", sourceLogicalVersion: "synthetic-1", sourceSha256: "b".repeat(64), declared: { inputsTotal: 4, controlOnlyInputs: 0, conditionTypes: 0 },
      inputs: [
        { key: "NUMERO", disposition: "VARIABLE", variable: "processo.numero", source: "PROCESS" }, { key: "ORGAO", disposition: "VARIABLE", variable: "orgao.nome", source: "IDENTITY" },
        { key: "CANAL", disposition: "VARIABLE", variable: "politica.canal", source: "POLICY" }, { key: "QUADRO", disposition: "ITEMS_TABLE", variable: "itens.quadro", source: "ITEMS" },
      ], conditionTypes: [], annexes: [], crossReferences: [], aiSlots: [] };
    const reg = await new ModelRegistrationService(wp as any).register(ctxOf(org), {
      target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: "edital-pregao-presencial-sintetico" }, templateKey: "EDITAL_PREGAO_PRESENCIAL_SINTETICO", displayName: "Edital — Pregão Presencial (sintético)",
      declaredScope: { modality: "pregao", form: "presencial" }, source: { kind: "AST", ast, catalogVersion: syn.version }, inventory: inv,
      sourceLogicalVersion: "synthetic-1", sourceSha256: "b".repeat(64), confirm: true, idempotencyKey: key("reg2"), decision: decision(),
    });
    await new TemplateGovernanceService(wp as any).recordLegalEvidence(ctxOf(org), { revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev3"), decision: decision(), evidence: { sourceLogicalVersion: "synthetic-1", sourceSha256: "b".repeat(64) } });
    const wf = new InstitutionalTemplatesWorkflow(wp as any);
    await wf.approve(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap3"), decision: decision() });
    await wf.publish(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb3"), decision: decision({ basisReference: "Ato 3" }), inventory: inv });
    await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { modality: "pregao", form: "presencial" }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
    const orgRec = await readGovernedRecord(org, "ORG", GOVERNED_ORG_SUBJECT, syn);   // o órgão já tem revisões (seed do BLL): CAS pela revisão corrente
    await new GovernedSourceService(catalog as any).recordOrganizationFields(ctxOf(org), { confirm: true, idempotencyKey: key("pol"), decision: decision(), catalogVersion: syn.version, expectedRevision: orgRec?.revision ?? 0, source: "POLICY", fields: { canal: "protocolo@exemplo.gov.br" } });

    const res = (scope: Record<string, string>) => wf.resolveBinding(ctxOf(org), { documentKind: "edital", scope, asOf: "2026-10-07T00:00:00Z" });
    const rBll = await res({ ...BLL.declaredScope });
    const rPres = await res({ modality: "pregao", form: "presencial" });
    expect(rBll.status === "RESOLVED" && rBll.revision.id).toBe(p.revisionId);
    expect(rPres.status === "RESOLVED" && rPres.revision.id).toBe(reg.revision.id);
    expect((await res({ modality: "pregao", form: "eletronica", platform: "licitanet" })).status).toBe("NOT_BOUND");   // sem fallback
    expect((await res({ modality: "pregao", form: "eletronica" })).status).toBe("NOT_BOUND");
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [org])).toBe(2);

    // o MESMO serviço de geração (despacho por versão do AST) compõe o segundo modelo — sem composer novo
    const g = await generateTemplatedDocument({
      organizationId: org, subjectId: p.w.processId, documentKind: "edital", documentType: "edital", scope: { modality: "pregao", form: "presencial" },
      asOf: "2026-10-07T00:00:00Z", title: "Edital presencial sintético", actorUserId: U_AUTHOR, correlationId: "corr-e9",
    }, cp as any);
    expect(g.generationManifest.templateRevisionId).toBe(reg.revision.id);
    expect(g.content).toContain("Edital presencial nº");
    expect(g.content).toContain("Papel sulfite A4 75g");
    expect(g.content).not.toContain("Preço unitário (R$)");   // nada do BLL vaza para o outro modelo
  }, 300_000);
});
