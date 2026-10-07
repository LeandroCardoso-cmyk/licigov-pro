/**
 * Institutional Templates — T2: persistência + HD-26 contra MySQL REAL (dados sintéticos; órgãos de teste isolados).
 * Só roda com DATABASE_URL. Cobre:
 *  P1  tenant: toda leitura/escrita é escopada; FK composta rejeita relação cross-tenant; mesmo tenant aceita; órfão rejeitado
 *  P2  lifecycle DRAFT→APPROVED→PUBLISHED→DEPRECATED com CAS; decisões distintas; PUBLISHED imutável; replay converge
 *  P3  binding: pin exato obrigatório, só PUBLISHED, um ativo por escopo, resolução determinística
 *  P4  manifest M1/M2: INSERT-only, replay converge, id com outro conteúdo conflita, pin exato das referências oficiais
 *  P5  rollback não deixa manifest parcial; concorrência determinística; compatível com o retry de deadlock do SEM-084
 *  P6  RESTRICT: pais referenciados não são apagados nem renumerados; a FK não é contornável pelo repositório
 *  P7  leitura fail-closed de registro corrompido; gate de schema íntegro
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema, collectSchemaProblems } from "../../bootstrap";
import {
  TemplatePersistenceError, assertDecisionInTenant, deactivateBinding, getBinding, getIdentity, getIssuanceManifestForOfficialDocument,
  getManifest, getManifestByHash, getRevision, insertBinding, insertDraftRevision, insertIdentity, listManifestsForGeneratedDocument,
  listRevisions, persistGenerationManifest, persistIssuanceManifest, resolveBinding, transitionRevisionStatus, updateDraftContent,
  withTemplatesTransaction, countRevisionReferences, type TemplatesContext,
} from "../../db/institutionalTemplates";
import { checkForeignKeyContract } from "../../db/schemaForeignKeyGuard";
import { bllCatalog } from "../helpers/institutionalTemplatesBllHarness";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeManifestHash, computeRevalidationResultHash, createDraftRevision, deriveIssuanceManifest, resolveTemplateBinding,
  revisionDeletionIssues, sealGenerationManifest,
  type CanonicalRevalidationRecord, type GenerationManifest, type TemplateAST, type TemplateBinding, type TemplateIdentity,
  type TemplateRevision, type VariableCatalog,
} from "../../domain/institutionalTemplates";

const DB = process.env.DATABASE_URL;
const RUN = (Date.now() % 1_000_000).toString(36);
const BASE = 970_000_000 + (Date.now() % 1_000_000) * 10;
const ORG_A = BASE;
const ORG_B = BASE + 1;
const ORGS = [ORG_A, ORG_B];
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const ctxOf = (organizationId: number): TemplatesContext => ({ organizationId, actorUserId: 1, correlationId: `corr-${RUN}` });
const CTX_A = ctxOf(ORG_A);
const CTX_B = ctxOf(ORG_B);

const catalog: VariableCatalog = { version: "cat-smoke/1", vars: [{ name: "objeto", type: "string", source: "TR", path: "object", required: true }] };
const astOf = (text: string): TemplateAST => ({ schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "text", v: text }, { t: "var", name: "objeto" }] }] });

let conn: mysql.Connection;
let seq = 0;
const nid = (p: string) => `${p}${RUN}${(seq++).toString(36)}`.slice(0, 24);
const exec = (sql: string, args: unknown[] = []) => conn.execute(sql, args as never);
const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => ((await conn.execute(sql, args as never))[0] as T[])[0];
const count = async (table: string, org: number, extra = "") => Number((await one<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE organization_id = ? ${extra}`, [org])).n);

async function cleanup(): Promise<void> {
  const q = ORGS.join(",");
  for (const sql of [
    `DELETE FROM document_composition_references WHERE organization_id IN (${q})`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q}) AND derived_from_manifest_id IS NOT NULL`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_events WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_bindings WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_revisions WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_identities WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_decisions WHERE organization_id IN (${q})`,
    `DELETE FROM official_documents WHERE tenant_id IN (${q})`,
    `DELETE FROM generated_documents WHERE organization_id IN (${q})`,
  ]) await conn.query(sql);
}

// ── fixtures sintéticas ───────────────────────────────────────────────────────────────────────────────────────────
async function seedDecision(org: number): Promise<string> {
  const id = nid("dc");
  await exec(
    `INSERT INTO institutional_decisions (id, organization_id, subject_type, subject_id, decision_type, outcome, revision, decided_by_name, decided_by_role, decided_at, basis_reference, reason, recorded_by_user_id, idempotency_key, request_hash)
     VALUES (?, ?, 'template.revision', ?, 'approval', 'ok', 1, 'Autoridade Sintética', 'Cargo', '2026-10-01', 'ato-1', 'motivo sintético', 1, ?, ?)`,
    [id, org, `${id}-subject`, id, sha(id)]);
  return id;
}
async function seedGenerated(org: number): Promise<string> {
  const id = nid("gd");
  await exec("INSERT INTO generated_documents (id, organization_id, process_id, kind, content) VALUES (?, ?, 'proc-sint', 'edital', 'conteúdo composto')", [id, org]);
  return id;
}
async function seedOfficial(tenant: number, content: string, version = 1): Promise<{ id: string; lineageId: string; version: number; contentHash: string }> {
  const id = nid("od"); const lineageId = nid("ln");
  await exec("INSERT INTO official_documents (id, tenant_id, lineage_id, version, status, content) VALUES (?, ?, ?, ?, 'emitido', ?)", [id, tenant, lineageId, version, content]);
  return { id, lineageId, version, contentHash: sha(content) };
}

interface World {
  org: number; ctx: TemplatesContext; identity: TemplateIdentity; revision: TemplateRevision;
  generatedId: string; tr: Awaited<ReturnType<typeof seedOfficial>>;
}
/** Identidade + revisão PUBLISHED + rascunho gerado + TR oficial, tudo no tenant informado. */
async function world(org: number, tag: string): Promise<World> {
  const ctx = ctxOf(org);
  const identity: TemplateIdentity = { id: nid("ti"), organizationId: org, documentKind: "edital", slug: `edital-${tag}-${RUN}`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
  const draft = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("Texto "), catalog, sourceFormat: "NATIVE" });
  if (!draft.ok) throw new Error(JSON.stringify(draft.issues));
  const approval = await seedDecision(org); const publication = await seedDecision(org);
  const revision = await withTemplatesTransaction("test.world", ctx, async (tx) => {
    await insertIdentity(tx, ctx, identity);
    await insertDraftRevision(tx, ctx, draft.value);
    await transitionRevisionStatus(tx, ctx, { revisionId: draft.value.id, to: "APPROVED", decisionId: approval });
    return (await transitionRevisionStatus(tx, ctx, { revisionId: draft.value.id, to: "PUBLISHED", decisionId: publication })).revision;
  });
  return { org, ctx, identity, revision, generatedId: await seedGenerated(org), tr: await seedOfficial(org, `TR sintético ${tag}`) };
}

const h = (c: string) => c.repeat(64);
function m1Of(w: World, over: Partial<GenerationManifest> = {}, id = nid("mg")): GenerationManifest {
  const sealed = sealGenerationManifest({
    stage: "GENERATION", id, organizationId: w.org, generatedDocumentId: w.generatedId, templateIdentityId: w.identity.id,
    templateRevisionId: w.revision.id, templateSemanticHash: w.revision.semanticHash, hashVersion: "tpl-hash/1", catalogVersion: catalog.version,
    sources: [{ key: "tr", digest: "srcd:tr=abcdef123456" }],
    officialDocRefs: [{ role: "ANEXO_I", order: 1, documentId: w.tr.id, lineageId: w.tr.lineageId, version: w.tr.version, contentHash: w.tr.contentHash, title: "Termo de Referência" }],
    conditionalDecisions: [{ nodePath: "root[0]", result: true, traceHash: h("a") }],
    aiNarratives: [{ slotKey: "justificativa", executionId: "exec-1", outputHash: h("b"), humanAccepted: true }],
    annexes: [], identityFingerprint: "ifp-1", composedOutputHash: h("c"), createdAt: "2026-10-05T12:00:00Z", ...over,
  });
  if (!sealed.ok) throw new Error(JSON.stringify(sealed.issues));
  return sealed.value;
}
function revalidation(): CanonicalRevalidationRecord {
  const base: CanonicalRevalidationRecord = {
    status: "PASSED", validatorVersion: "canonical-revalidation/1", checkedAuthorities: [{ authority: "itens", sourceVersion: "1", sourceHash: h("d") }],
    protectedNodes: [{ nodeId: "itens-table", expectedFragmentHash: h("e"), found: true }], structuralDeviations: [], resultHash: "", checkedAt: "2026-10-06T09:00:00Z",
  };
  return { ...base, resultHash: computeRevalidationResultHash(base) };
}
async function persistM1(w: World, m: GenerationManifest) {
  return withTemplatesTransaction("test.m1", w.ctx, (tx) => persistGenerationManifest(tx, w.ctx, m));
}
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return "NO_ERROR"; } catch (e) { return e instanceof TemplatePersistenceError ? e.code : `RAW:${(e as { code?: string }).code ?? (e as Error).message}`; }
};
const sqlCode = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return "NO_ERROR"; } catch (e) { const x = e as { code?: string; errno?: number }; return x.code ?? String(x.errno ?? (e as Error).message); }
};

describe.skipIf(!DB)("Institutional Templates — T2 persistência / HD-26 (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
    await cleanup();
  }, 300_000);
  afterAll(async () => { if (conn) { await cleanup().catch(() => {}); await conn.end(); } });

  it("P0 — gate de schema íntegro: validator do boot sem problemas e as 9 FKs críticas conferem com o banco real", async () => {
    expect(await collectSchemaProblems(conn)).toEqual([]);
    expect(await checkForeignKeyContract(conn)).toEqual([]);
  });

  describe("P1 — tenant", () => {
    it("toda leitura é escopada por tenant: o outro tenant não enxerga identidade, revisão, binding nem manifest", async () => {
      const a = await world(ORG_A, "p1a");
      const binding: TemplateBinding = { id: nid("bd"), organizationId: ORG_A, documentKind: "edital", scope: { modality: `p1-${RUN}` }, identityId: a.identity.id, pinnedRevisionId: a.revision.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z" };
      await withTemplatesTransaction("t", a.ctx, (tx) => insertBinding(tx, a.ctx, binding));
      const m1 = m1Of(a); await persistM1(a, m1);

      expect(await getIdentity(ORG_A, a.identity.id)).not.toBeNull();
      expect(await getIdentity(ORG_B, a.identity.id)).toBeNull();
      expect(await getRevision(ORG_B, a.revision.id)).toBeNull();
      expect(await listRevisions(ORG_B, a.identity.id)).toEqual([]);
      expect(await getBinding(ORG_B, binding.id)).toBeNull();
      expect(await getManifest(ORG_B, m1.id)).toBeNull();
      expect(await getManifestByHash(ORG_B, m1.manifestHash)).toBeNull();
      expect(await listManifestsForGeneratedDocument(ORG_B, a.generatedId)).toEqual([]);
      expect(await countRevisionReferences(ORG_B, a.revision.id)).toBe(0);
      expect(await countRevisionReferences(ORG_A, a.revision.id)).toBe(2); // 1 binding + 1 manifest
      expect(revisionDeletionIssues(a.revision, await countRevisionReferences(ORG_A, a.revision.id)).map((i) => i.code)).toEqual(["REVISION_IN_USE"]);
    });

    it("o tenant da ESCRITA é o do contexto autoritativo: payload de outro tenant é recusado antes de qualquer SQL", async () => {
      const a = await world(ORG_A, "p1b");
      const foreignIdentity = { ...a.identity, id: nid("ti"), organizationId: ORG_A };
      expect(await codeOf(withTemplatesTransaction("t", CTX_B, (tx) => insertIdentity(tx, CTX_B, foreignIdentity)))).toBe("CROSS_TENANT_REFERENCE");
      expect(await codeOf(withTemplatesTransaction("t", CTX_B, (tx) => insertDraftRevision(tx, CTX_B, a.revision)))).toBe("CROSS_TENANT_REFERENCE");
      expect(await codeOf(withTemplatesTransaction("t", CTX_B, (tx) => persistGenerationManifest(tx, CTX_B, m1Of(a))))).toBe("CROSS_TENANT_REFERENCE");
      // revisão do tenant B apontando para a identidade do tenant A: o lookup é escopado ⇒ "inexistente" (sem oráculo)
      const b = await world(ORG_B, "p1b");
      const crossRev = createDraftRevision({ id: nid("tr"), identity: { ...a.identity, organizationId: ORG_B }, revision: 7, ast: astOf("x"), catalog, sourceFormat: "NATIVE" });
      if (!crossRev.ok) throw new Error("fixture");
      expect(await codeOf(withTemplatesTransaction("t", CTX_B, (tx) => insertDraftRevision(tx, CTX_B, crossRev.value)))).toBe("NOT_FOUND");
      expect(b.identity.organizationId).toBe(ORG_B);
    });

    it("referências a tabelas EXISTENTES: o mesmo id em outro tenant é indistinguível de inexistente (REFERENCE_NOT_FOUND) e nada é persistido", async () => {
      const a = await world(ORG_A, "p1c");
      const b = await world(ORG_B, "p1c");
      // documento gerado do tenant B referenciado por manifest do tenant A
      const m = m1Of({ ...a, generatedId: b.generatedId });
      expect(await codeOf(persistM1(a, m))).toBe("REFERENCE_NOT_FOUND");
      // TR oficial do tenant B pinado por manifest do tenant A
      const m2 = m1Of({ ...a, tr: b.tr });
      expect(await codeOf(persistM1(a, m2))).toBe("REFERENCE_NOT_FOUND");
      // decisão do tenant B usada por revisão do tenant A
      const foreignDecision = await seedDecision(ORG_B);
      expect(await codeOf(withTemplatesTransaction("t", a.ctx, (tx) => assertDecisionInTenant(tx, ORG_A, foreignDecision)))).toBe("REFERENCE_NOT_FOUND");
      expect(await getManifest(ORG_A, m.id)).toBeNull();
      expect(await getManifest(ORG_A, m2.id)).toBeNull();
    });

    it("FK composta no banco: relação cross-tenant é rejeitada, mesmo tenant é aceito e órfão é rejeitado (SQL cru, sem passar pelo repositório)", async () => {
      const a = await world(ORG_A, "p1d");
      const insBinding = (org: number, identity: string, revision: string, scope: string) => exec(
        `INSERT INTO institutional_template_bindings (id, organization_id, document_kind, scope_modality, identity_id, pinned_revision_id, effective_from_iso) VALUES (?, ?, 'edital', ?, ?, ?, '2026-10-01T00:00:00Z')`,
        [nid("bd"), org, scope, identity, revision]);
      // mesmo tenant: aceito
      expect(await sqlCode(insBinding(ORG_A, a.identity.id, a.revision.id, `fk-ok-${RUN}`))).toBe("NO_ERROR");
      // cross-tenant: binding do tenant B com identidade/revisão do tenant A
      expect(await sqlCode(insBinding(ORG_B, a.identity.id, a.revision.id, `fk-x-${RUN}`))).toBe("ER_NO_REFERENCED_ROW_2");
      // órfão: revisão inexistente / identidade inexistente
      expect(await sqlCode(insBinding(ORG_A, a.identity.id, "inexistente", `fk-o1-${RUN}`))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(await sqlCode(insBinding(ORG_A, "inexistente", a.revision.id, `fk-o2-${RUN}`))).toBe("ER_NO_REFERENCED_ROW_2");
      // a revisão pertence a OUTRA identidade do mesmo tenant: a FK de pin exato rejeita
      const other = await world(ORG_A, "p1d2");
      expect(await sqlCode(insBinding(ORG_A, a.identity.id, other.revision.id, `fk-id-${RUN}`))).toBe("ER_NO_REFERENCED_ROW_2");

      const insRevision = (org: number, identity: string, rev: number) => exec(
        `INSERT INTO institutional_template_revisions (id, organization_id, identity_id, revision, ast_json, variable_catalog_version, semantic_hash, hash_version, source_format) VALUES (?, ?, ?, ?, '{}', 'c', ?, 'tpl-hash/1', 'NATIVE')`,
        [nid("tr"), org, identity, rev, h("1")]);
      expect(await sqlCode(insRevision(ORG_A, a.identity.id, 90))).toBe("NO_ERROR");
      expect(await sqlCode(insRevision(ORG_B, a.identity.id, 91))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(await sqlCode(insRevision(ORG_A, "inexistente", 92))).toBe("ER_NO_REFERENCED_ROW_2");

      const insEvent = (org: number, identity: string, rev: string | null) => exec(
        `INSERT INTO institutional_template_events (id, organization_id, identity_id, revision_id, event_type, actor_user_id) VALUES (?, ?, ?, ?, 'X', 1)`, [nid("ev"), org, identity, rev]);
      expect(await sqlCode(insEvent(ORG_A, a.identity.id, a.revision.id))).toBe("NO_ERROR");
      expect(await sqlCode(insEvent(ORG_B, a.identity.id, null))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(await sqlCode(insEvent(ORG_B, (await world(ORG_B, "p1d3")).identity.id, a.revision.id))).toBe("ER_NO_REFERENCED_ROW_2");

      const m = m1Of(a); await persistM1(a, m);
      const insManifest = (org: number, id: string, derived: string | null, rev = a.revision.id) => exec(
        `INSERT INTO document_composition_manifests (id, organization_id, stage, generated_document_id, template_identity_id, template_revision_id, template_semantic_hash, hash_version, catalog_version, identity_fingerprint, composed_output_hash, derived_from_manifest_id, manifest_hash, manifest_created_at_iso, body_json)
         VALUES (?, ?, 'GENERATION', 'g', ?, ?, ?, 'tpl-hash/1', 'c', 'f', ?, ?, ?, 'x', '{}')`, [id, org, a.identity.id, rev, h("1"), h("2"), derived, sha(id)]);
      expect(await sqlCode(insManifest(ORG_B, nid("mx"), null))).toBe("ER_NO_REFERENCED_ROW_2");           // revisão de outro tenant
      expect(await sqlCode(insManifest(ORG_A, nid("mx"), "inexistente"))).toBe("ER_NO_REFERENCED_ROW_2");   // derivação órfã
      expect(await sqlCode(insManifest(ORG_A, nid("mx"), m.id))).toBe("NO_ERROR");                          // derivação no mesmo tenant
      const m2 = nid("mx");
      await insManifest(ORG_A, m2, null);
      expect(await sqlCode(exec(`INSERT INTO document_composition_references (organization_id, manifest_id, ref_order, role, document_id, lineage_id, version, content_hash, title) VALUES (?, ?, 5, 'r', 'd', 'l', 1, ?, 't')`, [ORG_B, m2, h("3")]))).toBe("ER_NO_REFERENCED_ROW_2");
      expect(await sqlCode(exec(`INSERT INTO document_composition_references (organization_id, manifest_id, ref_order, role, document_id, lineage_id, version, content_hash, title) VALUES (?, ?, 5, 'r', 'd', 'l', 1, ?, 't')`, [ORG_A, m2, h("3")]))).toBe("NO_ERROR");
    });
  });

  describe("P2 — lifecycle e imutabilidade", () => {
    it("DRAFT → APPROVED → PUBLISHED → DEPRECATED: um passo por vez, decisões distintas, eventos append-only, replay converge", async () => {
      const ctx = CTX_A;
      const identity: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "tr", slug: `tr-${RUN}-p2`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const d = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("v1 "), catalog, sourceFormat: "MARKDOWN_IMPORT" });
      if (!d.ok) throw new Error("fixture");
      const created = await withTemplatesTransaction("t", ctx, async (tx) => { await insertIdentity(tx, ctx, identity); return insertDraftRevision(tx, ctx, d.value); });
      expect(created.created).toBe(true);
      expect(created.revision.status).toBe("DRAFT");
      expect(created.revision.sourceFormat).toBe("MARKDOWN_IMPORT");
      expect(created.revision).toEqual(d.value);

      const a1 = await seedDecision(ORG_A); const p1 = await seedDecision(ORG_A);
      const step = (to: "APPROVED" | "PUBLISHED" | "DEPRECATED", decisionId?: string) =>
        withTemplatesTransaction("t", ctx, (tx) => transitionRevisionStatus(tx, ctx, { revisionId: d.value.id, to, decisionId }));

      // não existe atalho DRAFT → PUBLISHED nem DRAFT → DEPRECATED
      expect(await codeOf(step("PUBLISHED", p1))).toBe("REVISION_TRANSITION_INVALID");
      expect(await codeOf(step("DEPRECATED"))).toBe("REVISION_TRANSITION_INVALID");
      // aprovar exige decisão; decisão de OUTRO tenant é recusada
      expect(await codeOf(step("APPROVED"))).toBe("INVALID_INPUT");
      expect(await codeOf(step("APPROVED", await seedDecision(ORG_B)))).toBe("REFERENCE_NOT_FOUND");

      const approved = await step("APPROVED", a1);
      expect(approved).toMatchObject({ changed: true, revision: { status: "APPROVED", approvalDecisionId: a1 } });
      expect(await step("APPROVED", a1)).toMatchObject({ changed: false });                // replay do mesmo passo converge
      expect(await codeOf(step("APPROVED", p1))).toBe("CONFLICT");                          // já aprovada com outra decisão
      expect(await codeOf(step("PUBLISHED", a1))).toBe("INVALID_INPUT");                    // APPROVED ≠ PUBLISHED: decisão distinta
      const published = await step("PUBLISHED", p1);
      expect(published.revision).toMatchObject({ status: "PUBLISHED", approvalDecisionId: a1, publishDecisionId: p1 });
      const deprecated = await step("DEPRECATED");
      expect(deprecated.revision.status).toBe("DEPRECATED");
      expect(await step("DEPRECATED")).toMatchObject({ changed: false });
      expect(await codeOf(step("PUBLISHED", p1))).toBe("REVISION_TRANSITION_INVALID");      // nada volta atrás

      // ledger de eventos: um por estado, ids determinísticos, nunca duplicados
      const events = (await conn.query<mysql.RowDataPacket[]>("SELECT event_type, from_status, to_status FROM institutional_template_events WHERE organization_id = ? AND revision_id = ? ORDER BY recorded_at, event_type", [ORG_A, d.value.id]))[0];
      expect(events.map((e) => e.event_type).sort()).toEqual(["REVISION_APPROVED", "REVISION_CREATED", "REVISION_DEPRECATED", "REVISION_PUBLISHED"]);
      // a revisão depreciada continua legível e válida (DEPRECATED ≠ INVALID)
      expect(await getRevision(ORG_A, d.value.id)).toMatchObject({ status: "DEPRECATED" });
    });

    it("conteúdo só muda em DRAFT; em PUBLISHED/APPROVED/DEPRECATED é REVISION_IMMUTABLE e nada é alterado em silêncio", async () => {
      const w = await world(ORG_A, "p2b"); // PUBLISHED
      const before = await one<{ ast_json: string; semantic_hash: string }>("SELECT ast_json, semantic_hash FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [ORG_A, w.revision.id]);
      expect(await codeOf(withTemplatesTransaction("t", w.ctx, (tx) => updateDraftContent(tx, w.ctx, w.revision.id, { ast: astOf("ALTERADO "), variableCatalogVersion: catalog.version })))).toBe("REVISION_IMMUTABLE");
      const after = await one<{ ast_json: string; semantic_hash: string }>("SELECT ast_json, semantic_hash FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [ORG_A, w.revision.id]);
      expect(after).toEqual(before);
      expect(await codeOf(withTemplatesTransaction("t", ctxOf(ORG_B), (tx) => updateDraftContent(tx, ctxOf(ORG_B), w.revision.id, { ast: astOf("x"), variableCatalogVersion: "c" })))).toBe("NOT_FOUND");

      // DRAFT aceita; o hash é DERIVADO do AST (nunca aceito do chamador) e muda com o conteúdo
      const identity: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "etp", slug: `etp-${RUN}-p2b`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const d = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("a "), catalog, sourceFormat: "NATIVE" });
      if (!d.ok) throw new Error("fixture");
      await withTemplatesTransaction("t", CTX_A, async (tx) => { await insertIdentity(tx, CTX_A, identity); await insertDraftRevision(tx, CTX_A, d.value); });
      const updated = await withTemplatesTransaction("t", CTX_A, (tx) => updateDraftContent(tx, CTX_A, d.value.id, { ast: astOf("b "), variableCatalogVersion: catalog.version }));
      expect(updated.semanticHash).not.toBe(d.value.semanticHash);
      // aprovada: o conteúdo congela
      await withTemplatesTransaction("t", CTX_A, async (tx) => transitionRevisionStatus(tx, CTX_A, { revisionId: d.value.id, to: "APPROVED", decisionId: await seedDecision(ORG_A) }));
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => updateDraftContent(tx, CTX_A, d.value.id, { ast: astOf("c "), variableCatalogVersion: catalog.version })))).toBe("REVISION_IMMUTABLE");
    });

    it("replay da criação converge; mesmo id/número com outro conteúdo conflita; hash informado que não confere é recusado", async () => {
      const identity: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "dfd", slug: `dfd-${RUN}-p2c`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const d = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("z "), catalog, sourceFormat: "NATIVE" });
      if (!d.ok) throw new Error("fixture");
      const first = await withTemplatesTransaction("t", CTX_A, async (tx) => { await insertIdentity(tx, CTX_A, identity); return insertDraftRevision(tx, CTX_A, d.value); });
      expect(first.created).toBe(true);
      const again = await withTemplatesTransaction("t", CTX_A, async (tx) => ({ i: await insertIdentity(tx, CTX_A, identity), r: await insertDraftRevision(tx, CTX_A, d.value) }));
      expect(again.i.created).toBe(false);
      expect(again.r.created).toBe(false);
      expect(await count("institutional_template_revisions", ORG_A, `AND identity_id = '${identity.id}'`)).toBe(1);
      // mesmo número de revisão com outro id e outro conteúdo ⇒ conflito
      const other = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("outro "), catalog, sourceFormat: "NATIVE" });
      if (!other.ok) throw new Error("fixture");
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => insertDraftRevision(tx, CTX_A, other.value)))).toBe("CONFLICT");
      // mesmo id, outro conteúdo ⇒ conflito
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => insertDraftRevision(tx, CTX_A, { ...other.value, id: d.value.id, revision: 1 })))).toBe("CONFLICT");
      // hash forjado ⇒ recusado antes de gravar
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => insertDraftRevision(tx, CTX_A, { ...other.value, id: nid("tr"), revision: 2, semanticHash: h("f") })))).toBe("INVALID_INPUT");
      // revisão nova só nasce DRAFT
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => insertDraftRevision(tx, CTX_A, { ...other.value, id: nid("tr"), revision: 3, status: "PUBLISHED" })))).toBe("INVALID_INPUT");
      // slug já usado sob outro id
      expect(await codeOf(withTemplatesTransaction("t", CTX_A, (tx) => insertIdentity(tx, CTX_A, { ...identity, id: nid("ti") })))).toBe("CONFLICT");
    });

    it("transições concorrentes (CAS): só uma decisão de aprovação vence; a outra vê CONFLICT; um único evento", async () => {
      const identity: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "parecer", slug: `parecer-${RUN}-p2d`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const d = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: astOf("c "), catalog, sourceFormat: "NATIVE" });
      if (!d.ok) throw new Error("fixture");
      await withTemplatesTransaction("t", CTX_A, async (tx) => { await insertIdentity(tx, CTX_A, identity); await insertDraftRevision(tx, CTX_A, d.value); });
      const decisions = await Promise.all(Array.from({ length: 6 }, () => seedDecision(ORG_A)));
      const results = await Promise.all(decisions.map((decisionId) =>
        codeOf(withTemplatesTransaction("t", CTX_A, (tx) => transitionRevisionStatus(tx, CTX_A, { revisionId: d.value.id, to: "APPROVED", decisionId })))));
      expect(results.filter((r) => r === "NO_ERROR")).toHaveLength(1);
      expect(results.filter((r) => r === "CONFLICT")).toHaveLength(5);
      const stored = await getRevision(ORG_A, d.value.id);
      expect(decisions).toContain(stored!.approvalDecisionId);
      expect(await count("institutional_template_events", ORG_A, `AND revision_id = '${d.value.id}' AND event_type = 'REVISION_APPROVED'`)).toBe(1);
    });
  });

  describe("P3 — binding", () => {
    it("pin exato obrigatório, só revisão PUBLISHED da mesma identidade, um ativo por escopo, resolução determinística", async () => {
      const w = await world(ORG_A, "p3");
      const mk = (over: Partial<TemplateBinding> = {}): TemplateBinding => ({
        id: nid("bd"), organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, identityId: w.identity.id,
        pinnedRevisionId: w.revision.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z", ...over,
      });
      const ins = (b: TemplateBinding) => withTemplatesTransaction("t", w.ctx, (tx) => insertBinding(tx, w.ctx, b));

      expect(await codeOf(ins(mk({ pinnedRevisionId: undefined })))).toBe("BINDING_REVISION_NOT_PINNED");
      expect(await codeOf(ins(mk({ scope: { modality: "" } })))).toBe("INVALID_INPUT");
      expect(await codeOf(ins(mk({ scope: { modality: "a|b" } })))).toBe("INVALID_INPUT");
      expect(await codeOf(ins(mk({ effectiveFrom: "ontem" })))).toBe("INVALID_INPUT");
      expect(await codeOf(ins(mk({ pinnedRevisionId: "inexistente" })))).toBe("REFERENCE_NOT_FOUND");
      // revisão de OUTRA identidade do mesmo tenant
      const other = await world(ORG_A, "p3o");
      expect(await codeOf(ins(mk({ pinnedRevisionId: other.revision.id })))).toBe("REFERENCE_NOT_FOUND");
      // revisão ainda em DRAFT
      const idn: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "edital", slug: `edital-${RUN}-p3d`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const dr = createDraftRevision({ id: nid("tr"), identity: idn, revision: 1, ast: astOf("d "), catalog, sourceFormat: "NATIVE" });
      if (!dr.ok) throw new Error("fixture");
      await withTemplatesTransaction("t", w.ctx, async (tx) => { await insertIdentity(tx, w.ctx, idn); await insertDraftRevision(tx, w.ctx, dr.value); });
      expect(await codeOf(ins(mk({ identityId: idn.id, pinnedRevisionId: dr.value.id })))).toBe("BINDING_REVISION_NOT_PUBLISHED");

      const b1 = mk();
      const created = await ins(b1);
      expect(created).toMatchObject({ created: true, binding: { id: b1.id, active: true, pinnedRevisionId: w.revision.id, scope: { modality: "pregao", regime: "empreitada" } } });
      expect((await ins(b1)).created).toBe(false);                                   // replay converge
      expect(await codeOf(ins(mk({ id: b1.id, effectiveFrom: "2027-01-01T00:00:00Z" })))).toBe("CONFLICT"); // mesmo id, outro conteúdo
      expect(await codeOf(ins(mk()))).toBe("BINDING_ACTIVE_SCOPE_TAKEN");            // outro ativo no mesmo escopo
      expect(await codeOf(ins(mk({ scope: { modality: "pregao" } })))).toBe("NO_ERROR"); // escopo diferente coexiste

      const res = await resolveBinding({ organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, asOf: "2026-10-05T00:00:00Z" });
      expect(res).toMatchObject({ status: "RESOLVED", revision: { id: w.revision.id, status: "PUBLISHED" } });
      expect((await resolveBinding({ organizationId: ORG_B, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, asOf: "2026-10-05T00:00:00Z" })).status).toBe("NOT_BOUND");

      // desativar libera o escopo; nunca apaga nem reativa; replay converge
      expect(await withTemplatesTransaction("t", w.ctx, (tx) => deactivateBinding(tx, w.ctx, b1.id))).toMatchObject({ changed: true });
      expect(await withTemplatesTransaction("t", w.ctx, (tx) => deactivateBinding(tx, w.ctx, b1.id))).toMatchObject({ changed: false });
      expect(await codeOf(withTemplatesTransaction("t", ctxOf(ORG_B), (tx) => deactivateBinding(tx, ctxOf(ORG_B), b1.id)))).toBe("NOT_FOUND");
      expect((await resolveBinding({ organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, asOf: "2026-10-05T00:00:00Z" })).status).toBe("NOT_BOUND");
      expect(await codeOf(ins(mk()))).toBe("NO_ERROR");

      // revisão depreciada com binding ativo: a resolução falha fechada (não resolve em silêncio)
      await withTemplatesTransaction("t", w.ctx, (tx) => transitionRevisionStatus(tx, w.ctx, { revisionId: w.revision.id, to: "DEPRECATED" }));
      const dep = await resolveBinding({ organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, asOf: "2026-10-05T00:00:00Z" });
      expect(dep.status).toBe("INVALID");
      expect(dep.status === "INVALID" && dep.issues[0].code).toBe("BINDING_REVISION_NOT_PUBLISHED");
      // o resolvedor puro do domínio concorda com o do repositório
      expect(resolveTemplateBinding({ organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao", regime: "empreitada" }, asOf: "2026-10-05T00:00:00Z" }, [], []).status).toBe("NOT_BOUND");
    });

    it("dois bindings ativos simultâneos para o mesmo escopo: exatamente um é criado", async () => {
      const w = await world(ORG_A, "p3c");
      const results = await Promise.all(Array.from({ length: 6 }, () => codeOf(withTemplatesTransaction("t", w.ctx, (tx) => insertBinding(tx, w.ctx, {
        id: nid("bd"), organizationId: ORG_A, documentKind: "edital", scope: { criterion: `menor-preco-${RUN}` }, identityId: w.identity.id,
        pinnedRevisionId: w.revision.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z",
      })))));
      expect(results.filter((r) => r === "NO_ERROR")).toHaveLength(1);
      expect(results.filter((r) => r === "BINDING_ACTIVE_SCOPE_TAKEN")).toHaveLength(5);
    });
  });

  describe("P4 — Composition Manifest (M1 / M2)", () => {
    it("M1: INSERT-only; replay idêntico converge; mesmo conteúdo sob outro id converge no primeiro; mesmo id com outro conteúdo conflita", async () => {
      const w = await world(ORG_A, "p4a");
      const m1 = m1Of(w);
      const first = await persistM1(w, m1);
      expect(first).toMatchObject({ created: true, officialDocumentId: null });
      expect(first.manifest).toEqual(m1);                                          // roundtrip exato (e o hash se prova)
      expect(await getManifest(ORG_A, m1.id)).toMatchObject({ manifest: m1 });
      expect(await getManifestByHash(ORG_A, m1.manifestHash)).toMatchObject({ manifest: m1 });

      const replay = await persistM1(w, m1);
      expect(replay).toMatchObject({ created: false });
      expect(replay.manifest.id).toBe(m1.id);

      // mesmo conteúdo semântico, outro id e outro createdAt: converge no manifest ORIGINAL
      const sameSemantics = m1Of(w, { createdAt: "2030-01-01T00:00:00Z" }, nid("mg"));
      expect(sameSemantics.manifestHash).toBe(m1.manifestHash);
      const converged = await persistM1(w, sameSemantics);
      expect(converged.created).toBe(false);
      expect(converged.manifest.id).toBe(m1.id);

      // mesmo id, conteúdo semântico diferente
      const different = m1Of(w, { composedOutputHash: h("9") }, m1.id);
      expect(await codeOf(persistM1(w, different))).toBe("MANIFEST_ID_CONFLICT");
      expect(await getManifest(ORG_A, m1.id)).toMatchObject({ manifest: m1 });     // o original NÃO foi alterado
      expect(await count("document_composition_manifests", ORG_A, `AND generated_document_id = '${w.generatedId}'`)).toBe(1);
      expect(await count("document_composition_references", ORG_A, `AND manifest_id = '${m1.id}'`)).toBe(1);
      expect((await listManifestsForGeneratedDocument(ORG_A, w.generatedId)).map((s) => s.manifest.id)).toEqual([m1.id]);
    });

    it("referências oficiais: pin exato (linhagem, versão, hash do conteúdo) — qualquer divergência recusa e nada é persistido", async () => {
      const w = await world(ORG_A, "p4b");
      const ref = (over: Record<string, unknown>) => ({ role: "ANEXO_I", order: 1, documentId: w.tr.id, lineageId: w.tr.lineageId, version: w.tr.version, contentHash: w.tr.contentHash, title: "TR", ...over });
      for (const [label, over] of [
        ["hash do conteúdo", { contentHash: h("0") }], ["versão", { version: 9 }], ["linhagem", { lineageId: "outra-linhagem" }],
      ] as const) {
        const m = m1Of(w, { officialDocRefs: [ref(over)] });
        expect(await codeOf(persistM1(w, m)), label).toBe("REFERENCE_PIN_MISMATCH");
        expect(await getManifest(ORG_A, m.id), label).toBeNull();
      }
      expect(await codeOf(persistM1(w, m1Of(w, { officialDocRefs: [ref({ documentId: "nao-existe" })] })))).toBe("REFERENCE_NOT_FOUND");
      // o pin é exato: uma nova versão do TR NÃO altera o manifest já persistido (e o pin antigo continua válido)
      const ok = m1Of(w, { officialDocRefs: [ref({})] });
      await persistM1(w, ok);
      await exec("UPDATE official_documents SET content = 'TR alterado' WHERE id = ? AND tenant_id = ?", [w.tr.id, ORG_A]);
      expect(await getManifest(ORG_A, ok.id)).toMatchObject({ manifest: ok });     // o manifest persistido é imutável
      expect(await codeOf(persistM1(w, m1Of(w, { officialDocRefs: [ref({})], composedOutputHash: h("8") })))).toBe("REFERENCE_PIN_MISMATCH"); // o conteúdo mudou
    });

    it("revisão do modelo: precisa ser PUBLISHED/DEPRECATED, do mesmo tenant e exatamente a informada (hash e catálogo)", async () => {
      const w = await world(ORG_A, "p4c");
      expect(await codeOf(persistM1(w, m1Of(w, { templateRevisionId: "inexistente" })))).toBe("REFERENCE_NOT_FOUND");
      expect(await codeOf(persistM1(w, m1Of(w, { templateSemanticHash: h("7") })))).toBe("INVALID_INPUT");
      expect(await codeOf(persistM1(w, m1Of(w, { catalogVersion: "outro-catalogo" })))).toBe("INVALID_INPUT");
      // revisão em DRAFT não compõe documento
      const idn: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "edital", slug: `edital-${RUN}-p4c`, createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
      const dr = createDraftRevision({ id: nid("tr"), identity: idn, revision: 1, ast: astOf("d "), catalog, sourceFormat: "NATIVE" });
      if (!dr.ok) throw new Error("fixture");
      await withTemplatesTransaction("t", w.ctx, async (tx) => { await insertIdentity(tx, w.ctx, idn); await insertDraftRevision(tx, w.ctx, dr.value); });
      expect(await codeOf(persistM1(w, m1Of(w, { templateIdentityId: idn.id, templateRevisionId: dr.value.id, templateSemanticHash: dr.value.semanticHash })))).toBe("INVALID_INPUT");
      // DEPRECATED ainda serve a documentos históricos
      await withTemplatesTransaction("t", w.ctx, (tx) => transitionRevisionStatus(tx, w.ctx, { revisionId: w.revision.id, to: "DEPRECATED" }));
      expect(await codeOf(persistM1(w, m1Of(w)))).toBe("NO_ERROR");
    });

    it("M2: registro DISTINTO derivado de M1, que permanece intacto; um por versão oficial; conteúdo emitido = conteúdo oficial", async () => {
      const w = await world(ORG_A, "p4d");
      const m1 = m1Of(w); await persistM1(w, m1);
      const m1Row = await one<Record<string, unknown>>("SELECT * FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [ORG_A, m1.id]);
      const issued = await seedOfficial(ORG_A, "Edital emitido (conteúdo humano revisado)");
      const derive = (over: Record<string, unknown> = {}, id = nid("mi")) => {
        const r = deriveIssuanceManifest(m1, {
          id, createdAt: "2026-10-06T10:00:00Z", documentContentHash: issued.contentHash,
          humanEditRefs: [{ editRef: "edit-1", resultingContentHash: issued.contentHash }], canonicalRevalidation: revalidation(), ...over,
        });
        if (!r.ok) throw new Error(JSON.stringify(r.issues));
        return r.value;
      };
      const persistM2 = (m: ReturnType<typeof derive>, officialId = issued.id) => withTemplatesTransaction("t", w.ctx, (tx) => persistIssuanceManifest(tx, w.ctx, m, officialId));

      const m2 = derive();
      const stored = await persistM2(m2);
      expect(stored).toMatchObject({ created: true, officialDocumentId: issued.id });
      expect(stored.manifest).toEqual(m2);
      expect(m2.derivedFromManifestId).toBe(m1.id);
      expect(m2.id).not.toBe(m1.id);
      // M1 não foi tocado
      expect(await one("SELECT * FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [ORG_A, m1.id])).toEqual(m1Row);
      expect(await getIssuanceManifestForOfficialDocument(ORG_A, issued.id)).toMatchObject({ manifest: { id: m2.id } });
      expect(await getIssuanceManifestForOfficialDocument(ORG_B, issued.id)).toBeNull();

      expect((await persistM2(m2)).created).toBe(false);                                           // replay converge
      expect((await persistM2(derive({ createdAt: "2031-01-01T00:00:00Z" } as never, nid("mi")))).manifest.id).toBe(m2.id); // outro id, mesmo conteúdo: converge
      // hash do conteúdo emitido que não é o do documento oficial persistido
      const wrongHash = derive({ documentContentHash: h("5"), humanEditRefs: [{ editRef: "e", resultingContentHash: h("5") }] });
      expect(await codeOf(persistM2(wrongHash))).toBe("REFERENCE_PIN_MISMATCH");
      // OUTRO conteúdo para a MESMA versão oficial: um manifest de emissão por versão
      const rev2 = { ...revalidation(), validatorVersion: "canonical-revalidation/2" };
      const conflicting = derive({ canonicalRevalidation: { ...rev2, resultHash: computeRevalidationResultHash(rev2) } });
      expect(await codeOf(persistM2(conflicting))).toBe("ISSUANCE_MANIFEST_CONFLICT");
      // versão oficial de outro tenant / inexistente
      expect(await codeOf(persistM2(derive({}, nid("mi")), (await seedOfficial(ORG_B, "x")).id))).toBe("REFERENCE_NOT_FOUND");
      expect(await codeOf(persistM2(derive({}, nid("mi")), "inexistente"))).toBe("REFERENCE_NOT_FOUND");
      // derivação adulterada: M2 que diz derivar de M1, mas herda um conteúdo que M1 não tem
      const tampered = { ...derive({}, nid("mi")), composedOutputHash: h("6") };
      const reSealed = { ...tampered, manifestHash: computeManifestHash(tampered) };
      const otherIssued = await seedOfficial(ORG_A, "outro emitido");
      expect(await codeOf(persistM2({ ...reSealed, documentContentHash: otherIssued.contentHash, humanEditRefs: [{ editRef: "e", resultingContentHash: otherIssued.contentHash }], manifestHash: "" } as never, otherIssued.id))).not.toBe("NO_ERROR");
      expect(await count("document_composition_manifests", ORG_A, `AND stage = 'ISSUANCE' AND generated_document_id = '${w.generatedId}'`)).toBe(1);
    });

    it("M2 só deriva de M1 do MESMO tenant e do estágio GENERATION", async () => {
      const a = await world(ORG_A, "p4e"); const m1a = m1Of(a); await persistM1(a, m1a);
      const issued = await seedOfficial(ORG_A, "emitido p4e");
      const r = deriveIssuanceManifest(m1a, { id: nid("mi"), createdAt: "x", documentContentHash: issued.contentHash, humanEditRefs: [{ editRef: "e", resultingContentHash: issued.contentHash }], canonicalRevalidation: revalidation() });
      if (!r.ok) throw new Error("fixture");
      // o tenant B não enxerga o M1 do tenant A como pai
      const asB = { ...r.value, organizationId: ORG_B };
      expect(await codeOf(withTemplatesTransaction("t", CTX_B, (tx) => persistIssuanceManifest(tx, CTX_B, { ...asB, manifestHash: computeManifestHash(asB as never) } as never, issued.id)))).not.toBe("NO_ERROR");
      expect(await getIssuanceManifestForOfficialDocument(ORG_B, issued.id)).toBeNull();
    });
  });

  describe("P5 — atomicidade, concorrência e retry de deadlock (SEM-084)", () => {
    it("rollback da transação não deixa manifest, referências nem eventos parciais", async () => {
      const w = await world(ORG_A, "p5a");
      const m1 = m1Of(w);
      const events = await count("institutional_template_events", ORG_A);
      await expect(withTemplatesTransaction("t", w.ctx, async (tx) => {
        await persistGenerationManifest(tx, w.ctx, m1);
        throw new Error("falha depois da escrita");
      })).rejects.toThrow("falha depois da escrita");
      expect(await getManifest(ORG_A, m1.id)).toBeNull();
      expect(await count("document_composition_manifests", ORG_A, `AND id = '${m1.id}'`)).toBe(0);
      expect(await count("document_composition_references", ORG_A, `AND manifest_id = '${m1.id}'`)).toBe(0);
      expect(await count("institutional_template_events", ORG_A)).toBe(events);
      expect((await persistM1(w, m1)).created).toBe(true); // e a mesma gravação depois funciona normalmente
    });

    it("retry de deadlock: a transação inteira é repetida e o resultado é UM manifest, com UM conjunto de referências", async () => {
      const w = await world(ORG_A, "p5b");
      const m1 = m1Of(w);
      let attempts = 0;
      const out = await withTemplatesTransaction("t", w.ctx, async (tx) => {
        const r = await persistGenerationManifest(tx, w.ctx, m1);
        if (++attempts === 1) throw Object.assign(new Error("Deadlock found when trying to get lock"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
        return r;
      });
      expect(attempts).toBe(2);
      expect(out.created).toBe(true);                       // a 1ª tentativa foi DESFEITA: a 2ª é quem criou
      expect(await count("document_composition_manifests", ORG_A, `AND generated_document_id = '${w.generatedId}'`)).toBe(1);
      expect(await count("document_composition_references", ORG_A, `AND manifest_id = '${m1.id}'`)).toBe(1);
      // erro que NÃO é deadlock propaga na 1ª ocorrência (sem retry, sem manifest)
      const w2 = await world(ORG_A, "p5b2"); const m2 = m1Of(w2); let tries = 0;
      await expect(withTemplatesTransaction("t", w2.ctx, async (tx) => { tries++; await persistGenerationManifest(tx, w2.ctx, m2); throw new Error("outro erro"); })).rejects.toThrow("outro erro");
      expect(tries).toBe(1);
      expect(await getManifest(ORG_A, m2.id)).toBeNull();
    });

    it("concorrência: o mesmo conteúdo, de N requisições com ids diferentes, vira UM manifest e todas convergem nele", async () => {
      const w = await world(ORG_A, "p5c");
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        persistM1(w, m1Of(w, { createdAt: `2026-10-05T12:00:0${i}Z` }, nid("mg")))));
      expect(new Set(results.map((r) => r.manifest.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await count("document_composition_manifests", ORG_A, `AND generated_document_id = '${w.generatedId}'`)).toBe(1);
      expect(await count("document_composition_references", ORG_A, `AND manifest_id = '${results[0].manifest.id}'`)).toBe(1);
    });

    it("concorrência: o MESMO id com conteúdos diferentes — exatamente um vence; os demais conflitam sem alterar o vencedor", async () => {
      const w = await world(ORG_A, "p5d");
      const id = nid("mg");
      const candidates = Array.from({ length: 6 }, (_, i) => m1Of(w, { composedOutputHash: h(String(i)) }, id));
      const out = await Promise.all(candidates.map((m) => codeOf(persistM1(w, m))));
      expect(out.filter((r) => r === "NO_ERROR")).toHaveLength(1);
      expect(out.filter((r) => r === "MANIFEST_ID_CONFLICT")).toHaveLength(5);
      const winner = await getManifest(ORG_A, id);
      expect(candidates.map((m) => m.manifestHash)).toContain(winner!.manifest.manifestHash);
      expect(await count("document_composition_manifests", ORG_A, `AND id = '${id}'`)).toBe(1);
    });
  });

  describe("P6 — RESTRICT e FK não contornável", () => {
    it("pai referenciado não é apagado nem renumerado; filho não migra de tenant; manifests e eventos são imutáveis na prática", async () => {
      const w = await world(ORG_A, "p6");
      const m1 = m1Of(w); await persistM1(w, m1);
      const bd: TemplateBinding = { id: nid("bd"), organizationId: ORG_A, documentKind: "edital", scope: { regime: `r-${RUN}` }, identityId: w.identity.id, pinnedRevisionId: w.revision.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z" };
      await withTemplatesTransaction("t", w.ctx, (tx) => insertBinding(tx, w.ctx, bd));

      // DELETE de pai com filhos ⇒ RESTRICT (sem CASCADE: nada some)
      expect(await sqlCode(exec("DELETE FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [ORG_A, w.revision.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("DELETE FROM institutional_template_identities WHERE organization_id = ? AND id = ?", [ORG_A, w.identity.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("DELETE FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [ORG_A, m1.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("DELETE FROM institutional_template_bindings WHERE organization_id = ? AND id = ?", [ORG_A, bd.id]))).toBe("ER_ROW_IS_REFERENCED_2"); // referenciado pelo evento BINDING_CREATED
      // UPDATE da chave referenciada ⇒ RESTRICT; mover o filho para outro tenant ⇒ FK
      expect(await sqlCode(exec("UPDATE institutional_template_revisions SET id = ? WHERE organization_id = ? AND id = ?", [nid("zz"), ORG_A, w.revision.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("UPDATE institutional_template_revisions SET organization_id = ? WHERE organization_id = ? AND id = ?", [ORG_B, ORG_A, w.revision.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("UPDATE institutional_template_bindings SET organization_id = ? WHERE organization_id = ? AND id = ?", [ORG_B, ORG_A, bd.id]))).toBe("ER_ROW_IS_REFERENCED_2");
      expect(await sqlCode(exec("UPDATE document_composition_manifests SET organization_id = ? WHERE organization_id = ? AND id = ?", [ORG_B, ORG_A, m1.id]))).not.toBe("NO_ERROR");
      // nada mudou
      expect(await getRevision(ORG_A, w.revision.id)).toMatchObject({ id: w.revision.id, status: "PUBLISHED" });
      expect(await getManifest(ORG_A, m1.id)).toMatchObject({ manifest: m1 });
      expect(await getBinding(ORG_A, bd.id)).toMatchObject({ id: bd.id });
    });

    it("as FKs críticas continuam batendo com o contrato depois de todo o uso (gate de schema)", async () => {
      expect(await checkForeignKeyContract(conn)).toEqual([]);
      expect(await collectSchemaProblems(conn)).toEqual([]);
    });
  });

  describe("P7 — leitura fail-closed", () => {
    it("revisão ou manifest adulterados no banco NUNCA são devolvidos: PERSISTED_RECORD_CORRUPT", async () => {
      const w = await world(ORG_A, "p7");
      const m1 = m1Of(w); await persistM1(w, m1);
      // adulteração do AST de uma revisão (o hash semântico deixa de conferir)
      const tamper = nid("tr");
      await exec(`INSERT INTO institutional_template_revisions (id, organization_id, identity_id, revision, ast_json, variable_catalog_version, semantic_hash, hash_version, source_format) VALUES (?, ?, ?, 99, '{"schema":"tpl-ast/1","root":[]}', 'c', ?, 'tpl-hash/1', 'NATIVE')`, [tamper, ORG_A, w.identity.id, h("1")]);
      expect(await codeOf(getRevision(ORG_A, tamper))).toBe("PERSISTED_RECORD_CORRUPT");
      // estado fora do lifecycle
      await exec("UPDATE institutional_template_revisions SET status = 'RETIRED' WHERE organization_id = ? AND id = ?", [ORG_A, tamper]);
      expect(await codeOf(getRevision(ORG_A, tamper))).toBe("PERSISTED_RECORD_CORRUPT");
      // adulteração de um campo coberto pelo hash do manifest
      await exec("UPDATE document_composition_manifests SET composed_output_hash = ? WHERE organization_id = ? AND id = ?", [h("9"), ORG_A, m1.id]);
      expect(await codeOf(getManifest(ORG_A, m1.id))).toBe("PERSISTED_RECORD_CORRUPT");
      expect(await codeOf(getManifestByHash(ORG_A, m1.manifestHash))).toBe("PERSISTED_RECORD_CORRUPT");
      await exec("UPDATE document_composition_manifests SET composed_output_hash = ? WHERE organization_id = ? AND id = ?", [m1.composedOutputHash, ORG_A, m1.id]);
      expect(await getManifest(ORG_A, m1.id)).toMatchObject({ manifest: m1 }); // restaurado: volta a provar a si mesmo
      // a referência oficial adulterada também é detectada
      await exec("UPDATE document_composition_references SET version = 77 WHERE organization_id = ? AND manifest_id = ?", [ORG_A, m1.id]);
      expect(await codeOf(getManifest(ORG_A, m1.id))).toBe("PERSISTED_RECORD_CORRUPT");
    });
  });

  describe("P8 — AST v2 (modelo BLL) persiste SEM alteração de schema", () => {
    it("a AST tpl-ast/2 completa (≈380 KB) faz round-trip em ast_json, o hash é recomputado igual, e o ciclo DRAFT→APPROVED→PUBLISHED funciona (banco de teste local)", async () => {
      const ast2 = JSON.parse(readFileSync(path.resolve(__dirname, "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll/ast.json"), "utf8"));
      const ctx = CTX_A;
      const identity: TemplateIdentity = { id: nid("ti"), organizationId: ORG_A, documentKind: "edital", slug: `edital-bll-v2-${RUN}`, createdAt: "2026-10-07T00:00:00Z", createdByUserId: 1 };
      const draft = createDraftRevision({ id: nid("tr"), identity, revision: 1, ast: ast2, catalog: bllCatalog, sourceFormat: "NATIVE" });
      if (!draft.ok) throw new Error(JSON.stringify(draft.issues).slice(0, 500));
      expect(bllCatalog.version.length).toBeLessThanOrEqual(64);
      const approval = await seedDecision(ORG_A); const publication = await seedDecision(ORG_A);
      const published = await withTemplatesTransaction("test.v2", ctx, async (tx) => {
        await insertIdentity(tx, ctx, identity);
        await insertDraftRevision(tx, ctx, draft.value);
        await transitionRevisionStatus(tx, ctx, { revisionId: draft.value.id, to: "APPROVED", decisionId: approval });
        return (await transitionRevisionStatus(tx, ctx, { revisionId: draft.value.id, to: "PUBLISHED", decisionId: publication })).revision;
      });
      expect(published.status).toBe("PUBLISHED");
      const back = await getRevision(ORG_A, draft.value.id);
      expect(back?.semanticHash).toBe(draft.value.semanticHash);
      expect(back?.ast).toEqual(ast2);
      expect(back?.variableCatalogVersion).toBe(bllCatalog.version);
    });
  });
});
