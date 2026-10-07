/**
 * Institutional Templates — T2 / HD-26: gate de FKs, contrato × schema × SQL × snapshot, e fail-closed da leitura.
 * Sem DB, sem rede. (A prova contra MySQL real está nos smokes `templates-*-mysql-smoke`.)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../../../drizzle/schema";
import {
  diffForeignKeyContract, validateForeignKeyContract,
  type ForeignKeyContract, type ObservedForeignKey, type ObservedIndex, type ObservedStructure,
} from "../../db/schemaForeignKeyGuard";
import { INSTITUTIONAL_TEMPLATES_FK_CONTRACT as CONTRACT, INSTITUTIONAL_TEMPLATES_TABLES } from "../../db/institutionalTemplates/schemaContract";
import { duplicateKeyName, isDuplicateKey, isForeignKeyViolation } from "../../db/institutionalTemplates/executor";
import { deterministicTemplateId } from "../../db/institutionalTemplates/ids";
import { rowToRevision } from "../../db/institutionalTemplates/revisions";
import { rowsToManifest } from "../../db/institutionalTemplates/manifests";
import { TemplatePersistenceError } from "../../db/institutionalTemplates/errors";
import {
  createDraftRevision, sealGenerationManifest, templateCanonicalJson,
  type GenerationManifest, type TemplateAST, type TemplateIdentity, type VariableCatalog,
} from "../../domain/institutionalTemplates";

const ROOT = process.cwd();
const DRZ = path.join(ROOT, "drizzle");
const TAG = "0316_institutional_templates_persistence";
const EXISTING_PARENTS = ["official_documents", "generated_documents", "institutional_decisions", "official_document_artifacts"];
const stripComments = (sql: string) => sql.replace(/^\s*--.*$/gm, "");

// ── estrutura saudável derivada do contrato (para mutar) ─────────────────────────────────────────────────────────
function healthy(): { tables: Set<string>; foreignKeys: ObservedForeignKey[]; indexes: ObservedIndex[] } {
  const indexes: ObservedIndex[] = [];
  for (const f of CONTRACT.foreignKeys) {
    if (!indexes.some((i) => i.table === f.refTable && i.unique && i.columns.join() === f.refColumns.join())) {
      indexes.push({ table: f.refTable, name: `uq_${f.refTable}_${f.refColumns.join("_")}`, unique: true, columns: [...f.refColumns] });
    }
    indexes.push({ table: f.table, name: `ix_${f.name}`, unique: false, columns: [...f.columns] });
  }
  return {
    tables: new Set(CONTRACT.tables),
    foreignKeys: CONTRACT.foreignKeys.map((f) => ({ name: f.name, table: f.table, columns: [...f.columns], refTable: f.refTable, refColumns: [...f.refColumns], deleteRule: f.onDelete, updateRule: f.onUpdate })),
    indexes,
  };
}
const codes = (o: ObservedStructure, c: ForeignKeyContract = CONTRACT) => diffForeignKeyContract(c, o).map((p) => p.code).sort();
const withFk = (name: string, patch: Partial<ObservedForeignKey>): ObservedStructure => {
  const h = healthy();
  return { ...h, foreignKeys: h.foreignKeys.map((f) => (f.name === name ? { ...f, ...patch } : f)) };
};

describe("HD-26 — gate de FKs: contrato e matriz de detecção", () => {
  it("o contrato respeita as regras (tenant lidera, só RESTRICT, tudo dentro do bounded context)", () => {
    expect(validateForeignKeyContract(CONTRACT)).toEqual([]);
    expect(CONTRACT.foreignKeys).toHaveLength(9);
    expect(CONTRACT.tables).toEqual(INSTITUTIONAL_TEMPLATES_TABLES);
  });

  it("estrutura saudável ⇒ nenhum problema; banco ainda sem as tabelas ⇒ nenhum problema (o ledger do boot cobre)", () => {
    expect(codes(healthy())).toEqual([]);
    expect(codes({ tables: new Set(), foreignKeys: [], indexes: [] })).toEqual([]);
  });

  it("FK crítica ausente", () => {
    const h = healthy();
    expect(codes({ ...h, foreignKeys: h.foreignKeys.filter((f) => f.name !== "fk_itb_revision") })).toEqual(["MISSING_CRITICAL_FK"]);
  });

  it("FK apontando para colunas ou tabela erradas", () => {
    expect(codes(withFk("fk_itb_revision", { columns: ["organization_id", "identity_id", "identity_id"] }))).toEqual(["WRONG_FK_COLUMNS"]);
    expect(codes(withFk("fk_ite_revision", { refColumns: ["organization_id", "revision"] }))).toEqual(["WRONG_FK_COLUMNS"]);
    expect(codes(withFk("fk_dcr_manifest", { refTable: "institutional_template_revisions" }))).toEqual(["WRONG_FK_COLUMNS"]);
  });

  it("tenant ausente da FK composta (filho, pai ou ambos)", () => {
    expect(codes(withFk("fk_itr_identity", { columns: ["identity_id"], refColumns: ["id"] }))).toEqual(["TENANT_MISSING_FROM_COMPOSITE_FK"]);
    expect(codes(withFk("fk_itr_identity", { columns: ["identity_id", "organization_id"], refColumns: ["id", "organization_id"] }))).toEqual(["TENANT_MISSING_FROM_COMPOSITE_FK"]);
    expect(codes(withFk("fk_itr_identity", { refColumns: ["id", "organization_id"] }))).toEqual(["TENANT_MISSING_FROM_COMPOSITE_FK"]);
  });

  it("pai sem a chave ÚNICA exata (índice comum, UNIQUE parcial ou na ordem errada)", () => {
    const h = healthy();
    const drop = (pred: (i: ObservedIndex) => boolean): ObservedStructure => ({ ...h, indexes: h.indexes.filter((i) => !pred(i)) });
    const parentKey = (t: string, cols: string[]) => (i: ObservedIndex) => i.table === t && i.unique && i.columns.join() === cols.join();
    expect(codes(drop(parentKey("institutional_template_identities", ["organization_id", "id"])))).toContain("INCOMPATIBLE_PARENT_INDEX");
    expect(codes({ ...drop(parentKey("institutional_template_identities", ["organization_id", "id"])), indexes: [...drop(parentKey("institutional_template_identities", ["organization_id", "id"])).indexes, { table: "institutional_template_identities", name: "ix_nonunique", unique: false, columns: ["organization_id", "id"] }] }))
      .toContain("INCOMPATIBLE_PARENT_INDEX");
    expect(codes({ ...h, indexes: [...h.indexes.filter((i) => !parentKey("institutional_template_identities", ["organization_id", "id"])(i)), { table: "institutional_template_identities", name: "uq_wrong", unique: true, columns: ["id", "organization_id"] }] }))
      .toContain("INCOMPATIBLE_PARENT_INDEX");
    // a chave-pai da identidade+revisão (pin exato) também é exigida
    expect(codes(drop(parentKey("institutional_template_revisions", ["organization_id", "identity_id", "id"])))).toContain("INCOMPATIBLE_PARENT_INDEX");
  });

  it("filho sem índice à esquerda com as colunas da FK", () => {
    const h = healthy();
    expect(codes({ ...h, indexes: h.indexes.filter((i) => i.name !== "ix_fk_ite_binding") })).toEqual(["MISSING_CHILD_INDEX"]);
  });

  it("regras proibidas: CASCADE, SET NULL, SET DEFAULT em DELETE ou UPDATE", () => {
    for (const rule of ["CASCADE", "SET NULL", "SET DEFAULT"]) {
      expect(codes(withFk("fk_dcm_revision", { deleteRule: rule })), `DELETE ${rule}`).toEqual(["FORBIDDEN_CASCADE"]);
      expect(codes(withFk("fk_dcm_revision", { updateRule: rule })), `UPDATE ${rule}`).toEqual(["FORBIDDEN_CASCADE"]);
    }
    expect(codes(withFk("fk_dcm_revision", { deleteRule: "NO ACTION", updateRule: "NO ACTION" }))).toEqual([]);
  });

  it("estado PARCIAL da migration (só parte das tabelas existe)", () => {
    const h = healthy();
    const partial: ObservedStructure = {
      tables: new Set(CONTRACT.tables.filter((t) => t !== "document_composition_references")),
      foreignKeys: h.foreignKeys.filter((f) => f.table !== "document_composition_references"), indexes: h.indexes,
    };
    expect(codes(partial)).toEqual(["PARTIAL_MIGRATION_STATE"]);
    expect(codes({ tables: new Set(["institutional_template_identities"]), foreignKeys: [], indexes: h.indexes })).toEqual(["PARTIAL_MIGRATION_STATE"]);
  });

  it("FK fora do contrato: de/para tabela produtiva existente é recusada", () => {
    const h = healthy();
    const toExisting: ObservedForeignKey = { name: "fk_x_official", table: "document_composition_manifests", columns: ["organization_id", "official_document_id"], refTable: "official_documents", refColumns: ["tenant_id", "id"], deleteRule: "RESTRICT", updateRule: "RESTRICT" };
    const fromExisting: ObservedForeignKey = { name: "fk_official_to_tpl", table: "official_documents", columns: ["template_revision"], refTable: "institutional_template_revisions", refColumns: ["id"], deleteRule: "RESTRICT", updateRule: "RESTRICT" };
    expect(codes({ ...h, foreignKeys: [...h.foreignKeys, toExisting] })).toEqual(["UNEXPECTED_FOREIGN_KEY"]);
    expect(codes({ ...h, foreignKeys: [...h.foreignKeys, fromExisting] })).toEqual(["UNEXPECTED_FOREIGN_KEY"]);
    // FK sem relação com o bounded context não é problema deste contrato
    expect(codes({ ...h, foreignKeys: [...h.foreignKeys, { ...toExisting, table: "outra", refTable: "outra_pai" }] })).toEqual([]);
  });

  it("um contrato mal formado é detectado antes de qualquer comparação", () => {
    const bad: ForeignKeyContract = {
      ...CONTRACT,
      foreignKeys: [{ name: "fk_bad", table: "institutional_template_revisions", columns: ["identity_id"], refTable: "institutional_template_identities", refColumns: ["id"], onDelete: "CASCADE" as never, onUpdate: "RESTRICT" }],
    };
    expect(validateForeignKeyContract(bad).map((p) => p.code).sort()).toEqual(["FORBIDDEN_CASCADE", "TENANT_MISSING_FROM_COMPOSITE_FK"]);
  });
});

describe("HD-26 — contrato × drizzle/schema.ts × SQL da 0316 × snapshot", () => {
  const tables = Object.values(schema).filter((v) => is(v, MySqlTable)).map((t) => getTableConfig(t as MySqlTable));
  const contractTables = tables.filter((t) => (CONTRACT.tables as readonly string[]).includes(t.name));

  it("schema.ts declara exatamente as FKs do contrato, compostas e RESTRICT; organization_id NOT NULL em todas as tabelas", () => {
    expect(contractTables.map((t) => t.name).sort()).toEqual([...CONTRACT.tables].sort());
    const declared = contractTables.flatMap((t) => t.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        name: fk.getName(), table: t.name, columns: ref.columns.map((c) => c.name), refTable: getTableConfig(ref.foreignTable).name,
        refColumns: ref.foreignColumns.map((c) => c.name), onDelete: fk.onDelete, onUpdate: fk.onUpdate,
      };
    })).sort((a, b) => a.name.localeCompare(b.name));
    expect(declared).toEqual([...CONTRACT.foreignKeys].map((f) => ({ ...f, columns: [...f.columns], refColumns: [...f.refColumns], onDelete: "restrict", onUpdate: "restrict" })).sort((a, b) => a.name.localeCompare(b.name)));
    for (const t of contractTables) {
      const org = t.columns.find((c) => c.name === "organization_id");
      expect(org?.notNull, `${t.name}.organization_id`).toBe(true);
    }
  });

  it("nenhuma tabela existente ganhou FK (nem para o bounded context nem entre si)", () => {
    for (const t of tables.filter((x) => !(CONTRACT.tables as readonly string[]).includes(x.name))) {
      expect(t.foreignKeys.map((f) => f.getName()), t.name).toEqual([]);
    }
  });

  const sql = readFileSync(path.join(DRZ, `${TAG}.sql`), "utf8");
  const code = stripComments(sql);
  const statements = sql.split("--> statement-breakpoint").map((s) => stripComments(s).trim()).filter(Boolean);

  it("a 0316 é puramente aditiva, replay-safe e não toca nenhuma tabela existente", () => {
    expect(statements).toHaveLength(6);
    for (const s of statements) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS `/);
    expect(code).not.toMatch(/\b(DROP\s|ALTER\s+TABLE|UPDATE\s+`|DELETE\s+FROM|TRUNCATE|RENAME|INSERT\s+INTO|SET\s+FOREIGN_KEY_CHECKS)\b/i);
    for (const t of EXISTING_PARENTS) expect(code, t).not.toContain(`\`${t}\``);
  });

  it("toda tabela da 0316 declara InnoDB + utf8mb4_unicode_ci e organization_id NOT NULL; nenhum CASCADE/SET NULL", () => {
    for (const s of statements) {
      expect(s).toMatch(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci$/);
      expect(s).toMatch(/`organization_id` int NOT NULL/);
    }
    expect(code).not.toMatch(/CASCADE|SET\s+NULL|SET\s+DEFAULT/i);
    expect((code.match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g) ?? []).length).toBe(CONTRACT.foreignKeys.length);
  });

  it("as FKs do SQL (inline) são exatamente as do contrato", () => {
    const parsed = [...code.matchAll(/CONSTRAINT `(\w+)` FOREIGN KEY \(([^)]+)\) REFERENCES `(\w+)`\(([^)]+)\)/g)].map((m) => {
      const cols = (s: string) => s.split(",").map((c) => c.replace(/[`\s]/g, ""));
      const table = [...statements].find((s) => s.includes(m[0]))!.match(/CREATE TABLE IF NOT EXISTS `(\w+)`/)![1];
      return { name: m[1], table, columns: cols(m[2]), refTable: m[3], refColumns: cols(m[4]) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    expect(parsed).toEqual(CONTRACT.foreignKeys.map((f) => ({ name: f.name, table: f.table, columns: [...f.columns], refTable: f.refTable, refColumns: [...f.refColumns] })).sort((a, b) => a.name.localeCompare(b.name)));
  });

  it("pais, em ordem: nenhuma tabela é criada antes do seu pai (replay/partial seguro)", () => {
    const order = statements.map((s) => s.match(/CREATE TABLE IF NOT EXISTS `(\w+)`/)![1]);
    const created = new Set<string>();
    for (const [i, s] of statements.entries()) {
      for (const m of s.matchAll(/REFERENCES `(\w+)`/g)) if (m[1] !== order[i]) expect(created.has(m[1]), `${order[i]} referencia ${m[1]}`).toBe(true);
      created.add(order[i]);
    }
  });

  it("journal: 0316 depois da 0315, com `when` maior, e o snapshot só ACRESCENTA as 6 tabelas (pais existentes inalterados)", () => {
    const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8")).entries as Array<{ idx: number; tag: string; when: number }>;
    const e316 = journal.find((e) => e.idx === 316)!;
    const e315 = journal.find((e) => e.idx === 315)!;
    expect(e316.tag).toBe(TAG);
    expect(e316.when).toBeGreaterThan(e315.when);
    // 0317 (escopo multi-modelo) é a ÚNICA migration posterior à 0316 neste contexto: aditiva, só nas tabelas do bounded context.
    expect(journal.filter((e) => e.idx > 317)).toEqual([]);
    const e317 = journal.find((e) => e.idx === 317)!;
    expect(e317.tag).toBe("0317_institutional_template_multimodel_scope");
    expect(e317.when).toBeGreaterThan(e316.when);

    const snap = (n: string) => JSON.parse(readFileSync(path.join(DRZ, "meta", `${n}_snapshot.json`), "utf8")) as { tables: Record<string, unknown> };
    const before = snap("0315").tables;
    const after = snap("0316").tables;
    const added = Object.keys(after).filter((k) => !(k in before)).sort();
    expect(added).toEqual([...CONTRACT.tables].sort());
    for (const k of Object.keys(before)) expect(templateCanonicalJson(after[k] as never), `tabela existente alterada: ${k}`).toBe(templateCanonicalJson(before[k] as never));

    // 0317: nenhuma tabela nova/removida; só identidades e bindings (criadas na 0316) mudam; nenhuma tabela produtiva existente.
    const after317 = snap("0317").tables;
    expect(Object.keys(after317).sort()).toEqual(Object.keys(after).sort());
    const changed = Object.keys(after).filter((k) => templateCanonicalJson(after317[k] as never) !== templateCanonicalJson(after[k] as never)).sort();
    expect(changed).toEqual(["institutional_template_bindings", "institutional_template_identities"]);
  });
});

describe("persistência — leitura fail-closed e utilidades puras", () => {
  const catalog: VariableCatalog = { version: "cat/1", vars: [{ name: "objeto", type: "string", source: "TR", path: "object", required: true }] };
  const ast: TemplateAST = { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "objeto" }] }] };
  const identity: TemplateIdentity = { id: "tplid_1", organizationId: 7, documentKind: "edital", slug: "edital", createdAt: "2026-10-01T00:00:00Z", createdByUserId: 1 };
  const draft = (() => {
    const r = createDraftRevision({ id: "tplrev_1", identity, revision: 1, ast, catalog, sourceFormat: "NATIVE" });
    if (!r.ok) throw new Error("fixture");
    return r.value;
  })();
  const revRow = (over: Record<string, unknown> = {}) => ({
    id: draft.id, organizationId: 7, identityId: draft.identityId, revision: 1, status: "DRAFT", astJson: templateCanonicalJson(ast),
    variableCatalogVersion: catalog.version, semanticHash: draft.semanticHash, hashVersion: "tpl-hash/1", sourceFormat: "NATIVE",
    approvalDecisionId: null, publishDecisionId: null, recordedAt: "2026-10-06 00:00:00.000", ...over,
  });

  it("a linha íntegra vira a revisão do domínio, recalculando o hash", () => {
    expect(rowToRevision(revRow() as never)).toEqual(draft);
  });

  it.each([
    ["hash adulterado", { semanticHash: "0".repeat(64) }],
    ["AST adulterado (hash não confere)", { astJson: templateCanonicalJson({ ...ast, root: [] }) }],
    ["AST ilegível", { astJson: "{" }],
    ["estado RETIRED (fora do lifecycle)", { status: "RETIRED" }],
    ["estado IN_REVIEW (fora do lifecycle)", { status: "IN_REVIEW" }],
    ["versão de hash desconhecida", { hashVersion: "tpl-hash/9" }],
    ["formato de origem desconhecido", { sourceFormat: "PDF" }],
  ])("revisão persistida corrompida ⇒ PERSISTED_RECORD_CORRUPT (%s)", (_l, over) => {
    expect(() => rowToRevision(revRow(over) as never)).toThrowError(TemplatePersistenceError);
    try { rowToRevision(revRow(over) as never); } catch (e) { expect((e as TemplatePersistenceError).code).toBe("PERSISTED_RECORD_CORRUPT"); }
  });

  const h = (c: string) => c.repeat(64);
  const sealed = (() => {
    const r = sealGenerationManifest({
      stage: "GENERATION", id: "man_1", organizationId: 7, generatedDocumentId: "gd_1", templateIdentityId: identity.id, templateRevisionId: draft.id,
      templateSemanticHash: draft.semanticHash, hashVersion: "tpl-hash/1", catalogVersion: catalog.version,
      sources: [{ key: "tr", digest: "srcd:tr=abcdef123456" }],
      officialDocRefs: [{ role: "ANEXO_I", order: 1, documentId: "od_1", lineageId: "lin_1", version: 2, contentHash: h("1"), title: "TR" }],
      conditionalDecisions: [], aiNarratives: [], annexes: [], identityFingerprint: "ifp", composedOutputHash: h("2"), createdAt: "2026-10-05T12:00:00Z",
    });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r.value as GenerationManifest;
  })();
  const mRow = (over: Record<string, unknown> = {}) => ({
    id: sealed.id, organizationId: 7, stage: "GENERATION", generatedDocumentId: sealed.generatedDocumentId, officialDocumentId: null,
    templateIdentityId: sealed.templateIdentityId, templateRevisionId: sealed.templateRevisionId, templateSemanticHash: sealed.templateSemanticHash,
    hashVersion: "tpl-hash/1", catalogVersion: sealed.catalogVersion, identityFingerprint: "ifp", composedOutputHash: sealed.composedOutputHash,
    documentContentHash: null, derivedFromManifestId: null, manifestHash: sealed.manifestHash, manifestCreatedAtIso: sealed.createdAt,
    bodyJson: templateCanonicalJson({ sources: sealed.sources, conditionalDecisions: [], aiNarratives: [], annexes: [] }),
    correlationId: "c", officialIssueKey: null, recordedAt: "x", ...over,
  });
  const refRows = [{ organizationId: 7, manifestId: "man_1", refOrder: 1, role: "ANEXO_I", documentId: "od_1", lineageId: "lin_1", version: 2, contentHash: h("1"), title: "TR", recordedAt: "x" }];

  it("o manifest íntegro é reconstruído e prova a si mesmo (hash recalculado)", () => {
    const stored = rowsToManifest(mRow() as never, refRows as never);
    expect(stored.manifest).toEqual(sealed);
    expect(stored.officialDocumentId).toBeNull();
  });

  it.each([
    ["conteúdo adulterado", { composedOutputHash: h("9") }, refRows],
    ["referência oficial adulterada", {}, [{ ...refRows[0], version: 3 }]],
    ["corpo ilegível", { bodyJson: "[" }, refRows],
    ["estágio desconhecido", { stage: "PUBLISHED" }, refRows],
    ["emissão incompleta", { stage: "ISSUANCE" }, refRows],
    ["versão de hash desconhecida", { hashVersion: "x" }, refRows],
  ])("manifest persistido corrompido ⇒ PERSISTED_RECORD_CORRUPT (%s)", (_l, over, refs) => {
    try { rowsToManifest(mRow(over) as never, refs as never); expect.unreachable("deveria falhar"); }
    catch (e) { expect(e).toBeInstanceOf(TemplatePersistenceError); expect((e as TemplatePersistenceError).code).toBe("PERSISTED_RECORD_CORRUPT"); }
  });

  it("ids determinísticos e detecção estrutural de erros do MySQL", () => {
    expect(deterministicTemplateId("tpe", 7, "REVISION_CREATED", "r1", "DRAFT")).toBe(deterministicTemplateId("tpe", 7, "REVISION_CREATED", "r1", "DRAFT"));
    expect(deterministicTemplateId("tpe", 7, "A")).not.toBe(deterministicTemplateId("tpe", 8, "A"));
    expect(deterministicTemplateId("tpe", 7, "A")).toHaveLength(24);
    const dup = { cause: { code: "ER_DUP_ENTRY", errno: 1062, message: "Duplicate entry 'x' for key 'institutional_template_bindings.uq_itb_active_scope'" } };
    expect(isDuplicateKey(dup)).toBe(true);
    expect(duplicateKeyName(dup)).toBe("uq_itb_active_scope");
    expect(isDuplicateKey(new Error("Duplicate entry"))).toBe(false); // nunca pelo texto
    expect(isForeignKeyViolation({ cause: { errno: 1452 } })).toBe(true);
    expect(isForeignKeyViolation({ cause: { code: "ER_ROW_IS_REFERENCED_2" } })).toBe(true);
    expect(isForeignKeyViolation(new Error("foreign key"))).toBe(false);
  });
});

describe("persistência — regras estáticas da camada de repositórios", () => {
  const dir = path.join(ROOT, "server", "db", "institutionalTemplates");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, code: stripComments(readFileSync(path.join(dir, f), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "") }));
  const all = files.map((x) => x.code).join("\n");

  it("nenhum DELETE, e UPDATE só em revisões (conteúdo DRAFT / transição com CAS) e bindings (desativação com CAS)", () => {
    expect(all).not.toMatch(/\.delete\(/);
    const updates = [...all.matchAll(/\.update\((\w+Table)\)/g)].map((m) => m[1]); // só UPDATE de tabela (não o `createHash().update`)
    expect(updates.sort()).toEqual(["institutionalTemplateBindingsTable", "institutionalTemplateRevisionsTable", "institutionalTemplateRevisionsTable"]);
    const rev = files.find((x) => x.f === "revisions.ts")!.code;
    expect(rev).toMatch(/eq\(institutionalTemplateRevisionsTable\.status, "DRAFT"\)/); // guard do UPDATE de conteúdo
    expect(rev).toMatch(/eq\(institutionalTemplateRevisionsTable\.status, current\.status\)/); // CAS da transição
    const bind = files.find((x) => x.f === "bindings.ts")!.code;
    expect(bind).toMatch(/eq\(institutionalTemplateBindingsTable\.active, 1\)/);
    const manifests = files.find((x) => x.f === "manifests.ts")!.code;
    expect(manifests).not.toMatch(/\.update\(|\.delete\(/); // INSERT-only
  });

  it("escritas exigem transação; as validações de pais existentes também (mesma transação — HD-26)", () => {
    for (const fn of ["insertIdentity", "insertDraftRevision", "updateDraftContent", "transitionRevisionStatus", "insertBinding", "deactivateBinding", "recordTemplateEvent"]) {
      expect(all, fn).toMatch(new RegExp(`${fn}\\(\\s*tx: TemplatesTx`));
    }
    for (const fn of ["assertGeneratedDocumentInTenant", "assertDecisionInTenant", "assertOfficialDocumentInTenant", "assertOfficialDocumentContentHash", "assertOfficialDocumentPin"]) {
      expect(all, fn).toMatch(new RegExp(`${fn}\\(\\s*tx: TemplatesTx`));
    }
    const parents = files.find((x) => x.f === "existingParents.ts")!.code;
    expect((parents.match(/\.for\("share"\)/g) ?? []).length).toBeGreaterThanOrEqual(3); // lock compartilhado no pai
    expect(parents).toMatch(/officialDocumentsTable\.tenantId, organizationId/); // id + tenant, nunca só id
    expect(parents).toMatch(/generatedDocumentsTable\.organizationId, organizationId/);
    expect(parents).toMatch(/institutionalDecisionsTable\.organizationId, organizationId/);
  });

  it("sem env direto, sem PLATFORM_GLOBAL, sem router/UI/IA/serviços de documento, sem fetch", () => {
    expect(all).not.toMatch(/process\.env|PLATFORM_GLOBAL|\bfetch\(|invokeLLM|aiExecutionEngine|trpc|documentEngineService|officialDocumentLifecycleService/);
    for (const { f, code } of files) {
      for (const m of code.matchAll(/from "((?:\.\.\/)+[^"]+)"/g)) {
        expect(m[1], `${f} importa ${m[1]}`).toMatch(/drizzle\/schema$|\.\.\/connection$|domain\/institutionalTemplates$|services\/transactionDeadlockRetry$|schemaForeignKeyGuard$/);
      }
    }
  });

  it("toda consulta a tabela institucional filtra por organization_id (nenhum acesso só por id)", () => {
    for (const { f, code } of files.filter((x) => ["identities.ts", "revisions.ts", "bindings.ts", "manifests.ts", "existingParents.ts"].includes(x.f))) {
      let at = code.indexOf(".select(");
      while (at !== -1) {
        // janela: o filtro de tenant pode ser montado logo antes (ex.: lista de condições) ou na própria cláusula `where`
        const window = code.slice(Math.max(0, at - 500), at + 900);
        expect(window, `${f}: select sem filtro de tenant perto de: ${code.slice(at, at + 90)}`).toMatch(/organizationId|tenantId/);
        at = code.indexOf(".select(", at + 1);
      }
    }
  });
});
