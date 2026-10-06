/**
 * Institutional Templates — persistência do COMPOSITION MANIFEST (T2). INSERT-ONLY.
 *
 *  - M1 (`GENERATION`) e M2 (`ISSUANCE`) são registros DISTINTOS; M2 referencia M1 (`derived_from_manifest_id`) e M1 nunca
 *    é reescrito. Não existe UPDATE nem DELETE neste módulo (travado por teste estático e pela FK RESTRICT);
 *  - REPLAY CONVERGE: mesmo conteúdo semântico (`manifest_hash`) ⇒ o MESMO manifest, `created: false`, mesmo sob outro id
 *    (UNIQUE `(organization_id, manifest_hash)`); mesmo id com conteúdo semântico diferente ⇒ MANIFEST_ID_CONFLICT. Um
 *    manifest de emissão por versão oficial (UNIQUE da chave gerada). Compatível com o retry de deadlock do SEM-084: a
 *    transação inteira é repetida, o que foi desfeito não deixa manifest parcial, e uma reexecução converge;
 *  - a LEITURA reconstrói o manifest (colunas + `body_json` + referências) e RECALCULA o `manifestHash` com o domínio:
 *    divergência ⇒ PERSISTED_RECORD_CORRUPT (nunca devolve um manifest que não prova a si mesmo);
 *  - HD-26: relações com tabelas EXISTENTES validadas por id + tenant NA MESMA transação — `generated_documents`,
 *    `official_documents` (existência, pin exato das referências e hash do conteúdo emitido). A revisão do modelo e a
 *    derivação M1 → M2 são relações entre tabelas novas: FK composta no banco + checagem de consistência aqui.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  documentCompositionManifestsTable, documentCompositionReferencesTable,
  type DocumentCompositionManifestRow, type DocumentCompositionReferenceRow,
} from "../../../drizzle/schema";
import {
  TEMPLATE_HASH_VERSION, TEMPLATE_ID_RE, manifestRevisionIssues, templateCanonicalJson, validateManifest,
  type AiNarrativeRef, type AnnexRef, type CanonicalRevalidationRecord, type CompositionManifest, type ConditionalDecisionRef,
  type GenerationManifest, type HashVersion, type HumanEditRef, type IssuanceManifest, type ManifestSourceRef, type OfficialDocumentReference,
} from "../../domain/institutionalTemplates";
import { TemplatePersistenceError } from "./errors";
import { isDuplicateKey, isForeignKeyViolation, requireReader, type TemplatesContext, type TemplatesReader, type TemplatesTx } from "./executor";
import {
  assertGeneratedDocumentInTenant, assertOfficialDocumentContentHash, assertOfficialDocumentInTenant, assertOfficialDocumentPin,
} from "./existingParents";
import { lockRevisionForShare } from "./revisions";

interface ManifestBody {
  readonly sources: readonly ManifestSourceRef[];
  readonly conditionalDecisions: readonly ConditionalDecisionRef[];
  readonly aiNarratives: readonly AiNarrativeRef[];
  readonly annexes: readonly AnnexRef[];
  readonly humanEditRefs?: readonly HumanEditRef[];
  readonly canonicalRevalidation?: CanonicalRevalidationRecord;
}

const corrupt = (why: string) => new TemplatePersistenceError("PERSISTED_RECORD_CORRUPT", `manifest persistido inválido: ${why}`);

/** Manifest + o vínculo com a versão oficial emitida (envelope de persistência; fora do hash semântico do domínio). */
export interface StoredManifest {
  readonly manifest: CompositionManifest;
  /** `official_documents.id` da versão emitida (ISSUANCE) ou `null` (GENERATION). */
  readonly officialDocumentId: string | null;
  readonly correlationId: string;
}
export interface PersistedManifest extends StoredManifest { readonly created: boolean }

function bodyOf(m: CompositionManifest): ManifestBody {
  const common = { sources: m.sources, conditionalDecisions: m.conditionalDecisions, aiNarratives: m.aiNarratives, annexes: m.annexes };
  return m.stage === "ISSUANCE" ? { ...common, humanEditRefs: m.humanEditRefs, canonicalRevalidation: m.canonicalRevalidation } : common;
}

/** Linhas → manifest do domínio, RECALCULANDO o hash (fail-closed). */
export function rowsToManifest(row: DocumentCompositionManifestRow, refRows: readonly DocumentCompositionReferenceRow[]): StoredManifest {
  let body: ManifestBody;
  try { body = JSON.parse(row.bodyJson) as ManifestBody; } catch { throw corrupt("corpo ilegível"); }
  if (row.hashVersion !== TEMPLATE_HASH_VERSION) throw corrupt(`versão de hash desconhecida (${row.hashVersion})`);
  const officialDocRefs: OfficialDocumentReference[] = [...refRows].sort((a, b) => a.refOrder - b.refOrder).map((r) => ({
    role: r.role, order: r.refOrder, documentId: r.documentId, lineageId: r.lineageId, version: r.version, contentHash: r.contentHash, title: r.title,
  }));
  const common = {
    id: row.id, organizationId: row.organizationId, generatedDocumentId: row.generatedDocumentId,
    templateIdentityId: row.templateIdentityId, templateRevisionId: row.templateRevisionId, templateSemanticHash: row.templateSemanticHash,
    hashVersion: row.hashVersion as HashVersion, catalogVersion: row.catalogVersion, sources: body.sources, officialDocRefs,
    conditionalDecisions: body.conditionalDecisions, aiNarratives: body.aiNarratives, annexes: body.annexes,
    identityFingerprint: row.identityFingerprint, composedOutputHash: row.composedOutputHash, manifestHash: row.manifestHash,
    createdAt: row.manifestCreatedAtIso,
  };
  let manifest: CompositionManifest;
  if (row.stage === "GENERATION") {
    manifest = { ...common, stage: "GENERATION" };
  } else if (row.stage === "ISSUANCE") {
    if (!row.derivedFromManifestId || !row.documentContentHash || !body.canonicalRevalidation || !body.humanEditRefs) throw corrupt("manifest de emissão incompleto");
    manifest = {
      ...common, stage: "ISSUANCE", derivedFromManifestId: row.derivedFromManifestId, documentContentHash: row.documentContentHash,
      humanEditRefs: body.humanEditRefs, canonicalRevalidation: body.canonicalRevalidation,
    };
  } else {
    throw corrupt(`estágio desconhecido (${row.stage})`);
  }
  const checked = validateManifest(manifest);
  if (!checked.ok) throw corrupt(checked.issues.map((i) => `${i.code}@${i.path}`).join(", "));
  return { manifest, officialDocumentId: row.officialDocumentId ?? null, correlationId: row.correlationId };
}

async function loadRefs(db: TemplatesReader, organizationId: number, manifestId: string): Promise<DocumentCompositionReferenceRow[]> {
  return db.select().from(documentCompositionReferencesTable).where(and(
    eq(documentCompositionReferencesTable.organizationId, organizationId), eq(documentCompositionReferencesTable.manifestId, manifestId)))
    .orderBy(asc(documentCompositionReferencesTable.refOrder));
}

async function hydrate(db: TemplatesReader, row: DocumentCompositionManifestRow): Promise<StoredManifest> {
  return rowsToManifest(row, await loadRefs(db, row.organizationId, row.id));
}

export async function getManifest(organizationId: number, id: string, executor?: TemplatesReader): Promise<StoredManifest | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(documentCompositionManifestsTable).where(and(
    eq(documentCompositionManifestsTable.organizationId, organizationId), eq(documentCompositionManifestsTable.id, id))).limit(1);
  return rows.length === 1 && rows[0].id === id ? hydrate(db, rows[0]) : null;
}

export async function getManifestByHash(organizationId: number, manifestHash: string, executor?: TemplatesReader): Promise<StoredManifest | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(documentCompositionManifestsTable).where(and(
    eq(documentCompositionManifestsTable.organizationId, organizationId), eq(documentCompositionManifestsTable.manifestHash, manifestHash))).limit(1);
  return rows.length === 1 ? hydrate(db, rows[0]) : null;
}

/** O manifest de EMISSÃO da versão oficial (no máximo um por versão — INV-TPL-29). */
export async function getIssuanceManifestForOfficialDocument(
  organizationId: number, officialDocumentId: string, executor?: TemplatesReader,
): Promise<StoredManifest | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(documentCompositionManifestsTable).where(and(
    eq(documentCompositionManifestsTable.organizationId, organizationId),
    eq(documentCompositionManifestsTable.stage, "ISSUANCE"),
    eq(documentCompositionManifestsTable.officialDocumentId, officialDocumentId))).limit(1);
  return rows.length === 1 && rows[0].officialDocumentId === officialDocumentId ? hydrate(db, rows[0]) : null;
}

export async function listManifestsForGeneratedDocument(
  organizationId: number, generatedDocumentId: string, executor?: TemplatesReader,
): Promise<StoredManifest[]> {
  const db = await requireReader(executor);
  const rows = await db.select().from(documentCompositionManifestsTable).where(and(
    eq(documentCompositionManifestsTable.organizationId, organizationId),
    eq(documentCompositionManifestsTable.generatedDocumentId, generatedDocumentId))).orderBy(asc(documentCompositionManifestsTable.recordedAt), asc(documentCompositionManifestsTable.id));
  const out: StoredManifest[] = [];
  for (const r of rows) out.push(await hydrate(db, r));
  return out;
}

async function lockManifestRow(tx: TemplatesTx, organizationId: number, where: "id" | "hash", value: string): Promise<DocumentCompositionManifestRow | null> {
  const col = where === "id" ? documentCompositionManifestsTable.id : documentCompositionManifestsTable.manifestHash;
  const rows = await tx.select().from(documentCompositionManifestsTable)
    .where(and(eq(documentCompositionManifestsTable.organizationId, organizationId), eq(col, value))).limit(1).for("share");
  if (rows.length !== 1) return null;
  if (where === "id" && rows[0].id !== value) return null;
  return rows[0];
}

function assertLength(label: string, value: string, max: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TemplatePersistenceError("INVALID_INPUT", `${label} deve ter de 1 a ${max} caracteres`);
  }
}

/**
 * Parte do manifest que um M2 herda, sem alteração, do M1 de que deriva. Das narrativas de IA herdam-se a IDENTIDADE
 * (slot, execução, hash da saída); o aceite humano (`humanAccepted`) é justamente o que a emissão acrescenta — o M1 é
 * `false` e o M2 é `true` — e por isso fica fora da comparação (a regra do aceite é do domínio, na revalidação).
 */
function inheritedPart(m: CompositionManifest): string {
  return templateCanonicalJson({
    organizationId: m.organizationId, generatedDocumentId: m.generatedDocumentId, templateIdentityId: m.templateIdentityId,
    templateRevisionId: m.templateRevisionId, templateSemanticHash: m.templateSemanticHash, hashVersion: m.hashVersion,
    catalogVersion: m.catalogVersion, sources: m.sources, officialDocRefs: m.officialDocRefs, conditionalDecisions: m.conditionalDecisions,
    aiNarratives: m.aiNarratives.map((n) => ({ slotKey: n.slotKey, executionId: n.executionId, outputHash: n.outputHash })),
    annexes: m.annexes, identityFingerprint: m.identityFingerprint, composedOutputHash: m.composedOutputHash,
  });
}

async function persistManifest(
  tx: TemplatesTx, ctx: TemplatesContext, manifest: CompositionManifest, officialDocumentId: string | null,
): Promise<PersistedManifest> {
  // 1) tenant autoritativo do contexto + forma
  if (manifest.organizationId !== ctx.organizationId) {
    throw new TemplatePersistenceError("CROSS_TENANT_REFERENCE", "o manifest pertence a outra organização que o contexto autoritativo");
  }
  if ((manifest.stage === "ISSUANCE") !== (officialDocumentId !== null)) {
    throw new TemplatePersistenceError("INVALID_INPUT", "a versão oficial é obrigatória no manifest de emissão e proibida no de geração");
  }
  const checked = validateManifest(manifest);
  if (!checked.ok) throw new TemplatePersistenceError("INVALID_INPUT", "manifest inválido", checked.issues);
  if (!TEMPLATE_ID_RE.test(manifest.id)) throw new TemplatePersistenceError("INVALID_INPUT", "id do manifest inválido (até 24 caracteres)");
  assertLength("generatedDocumentId", manifest.generatedDocumentId, 20);
  assertLength("identityFingerprint", manifest.identityFingerprint, 64);
  assertLength("catalogVersion", manifest.catalogVersion, 64);
  assertLength("createdAt", manifest.createdAt, 40);
  if (officialDocumentId !== null) assertLength("officialDocumentId", officialDocumentId, 20);
  for (const r of manifest.officialDocRefs) {
    assertLength("referência.documentId", r.documentId, 20); assertLength("referência.lineageId", r.lineageId, 20);
    assertLength("referência.role", r.role, 64); assertLength("referência.title", r.title, 255);
  }

  // 2) relações com tabelas EXISTENTES — id + tenant, na MESMA transação (HD-26)
  await assertGeneratedDocumentInTenant(tx, ctx.organizationId, manifest.generatedDocumentId);
  for (const r of manifest.officialDocRefs) {
    await assertOfficialDocumentPin(tx, ctx.organizationId, { documentId: r.documentId, lineageId: r.lineageId, version: r.version, contentHash: r.contentHash });
  }
  // 3) relações entre tabelas NOVAS — consistência (a FK composta garante a existência e o tenant no banco)
  const revision = await lockRevisionForShare(tx, ctx.organizationId, manifest.templateRevisionId);
  if (!revision) throw new TemplatePersistenceError("REFERENCE_NOT_FOUND", "revisão do modelo inexistente neste tenant");
  const revisionIssues = manifestRevisionIssues(manifest, revision);
  if (revisionIssues.length) throw new TemplatePersistenceError("INVALID_INPUT", "o manifest não corresponde à revisão exata do modelo", revisionIssues);

  if (manifest.stage === "ISSUANCE") {
    await assertOfficialDocumentInTenant(tx, ctx.organizationId, officialDocumentId as string);
    await assertOfficialDocumentContentHash(tx, ctx.organizationId, officialDocumentId as string, manifest.documentContentHash);
    const parentRow = await lockManifestRow(tx, ctx.organizationId, "id", manifest.derivedFromManifestId);
    if (!parentRow) throw new TemplatePersistenceError("REFERENCE_NOT_FOUND", "manifest de geração inexistente neste tenant");
    const parent = (await hydrate(tx, parentRow)).manifest;
    if (parent.stage !== "GENERATION" || inheritedPart(parent) !== inheritedPart(manifest)) {
      throw new TemplatePersistenceError("MANIFEST_DERIVATION_MISMATCH", "o manifest de emissão não deriva, sem alterações, do manifest de geração informado");
    }
  }

  // 4) INSERT-only; replay converge, conteúdo diferente conflita
  const body = templateCanonicalJson(bodyOf(manifest) as unknown as Record<string, unknown>);
  try {
    await tx.insert(documentCompositionManifestsTable).values({
      id: manifest.id, organizationId: manifest.organizationId, stage: manifest.stage,
      generatedDocumentId: manifest.generatedDocumentId, officialDocumentId,
      templateIdentityId: manifest.templateIdentityId, templateRevisionId: manifest.templateRevisionId,
      templateSemanticHash: manifest.templateSemanticHash, hashVersion: manifest.hashVersion, catalogVersion: manifest.catalogVersion,
      identityFingerprint: manifest.identityFingerprint, composedOutputHash: manifest.composedOutputHash,
      documentContentHash: manifest.stage === "ISSUANCE" ? manifest.documentContentHash : null,
      derivedFromManifestId: manifest.stage === "ISSUANCE" ? manifest.derivedFromManifestId : null,
      manifestHash: manifest.manifestHash, manifestCreatedAtIso: manifest.createdAt, bodyJson: body,
      correlationId: ctx.correlationId.slice(0, 64),
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) throw new TemplatePersistenceError("REFERENCE_NOT_FOUND", "referência estrutural do manifest inexistente neste tenant");
    if (!isDuplicateKey(err)) throw err;
    // leituras travantes (`FOR SHARE`) enxergam o commit concorrente mesmo sob REPEATABLE READ
    const byHash = await lockManifestRow(tx, ctx.organizationId, "hash", manifest.manifestHash);
    if (byHash) {
      if ((byHash.officialDocumentId ?? null) !== officialDocumentId) {
        throw new TemplatePersistenceError("ISSUANCE_MANIFEST_CONFLICT", "o mesmo conteúdo já está registrado para outra versão oficial");
      }
      return { ...(await hydrate(tx, byHash)), created: false };
    }
    if (await lockManifestRow(tx, ctx.organizationId, "id", manifest.id)) {
      throw new TemplatePersistenceError("MANIFEST_ID_CONFLICT", "o id do manifest já existe com outro conteúdo semântico");
    }
    if (officialDocumentId !== null) {
      throw new TemplatePersistenceError("ISSUANCE_MANIFEST_CONFLICT", "já existe um manifest de emissão, com outro conteúdo, para esta versão oficial");
    }
    throw err;
  }
  if (manifest.officialDocRefs.length > 0) {
    try {
      await tx.insert(documentCompositionReferencesTable).values(manifest.officialDocRefs.map((r) => ({
        organizationId: manifest.organizationId, manifestId: manifest.id, refOrder: r.order, role: r.role,
        documentId: r.documentId, lineageId: r.lineageId, version: r.version, contentHash: r.contentHash, title: r.title,
      })));
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new TemplatePersistenceError("REFERENCE_NOT_FOUND", "referência estrutural do manifest inexistente neste tenant");
      throw err;
    }
  }
  const row = await lockManifestRow(tx, ctx.organizationId, "id", manifest.id);
  if (!row) throw corrupt("manifest não encontrado após a inserção");
  return { ...(await hydrate(tx, row)), created: true };
}

/** M1 — manifest da geração (rascunho composto). */
export function persistGenerationManifest(tx: TemplatesTx, ctx: TemplatesContext, manifest: GenerationManifest): Promise<PersistedManifest> {
  return persistManifest(tx, ctx, manifest, null);
}

/** M2 — manifest derivado da emissão, vinculado à versão oficial `emitido` (validada id + tenant na mesma transação). */
export function persistIssuanceManifest(
  tx: TemplatesTx, ctx: TemplatesContext, manifest: IssuanceManifest, officialDocumentId: string,
): Promise<PersistedManifest> {
  return persistManifest(tx, ctx, manifest, officialDocumentId);
}
