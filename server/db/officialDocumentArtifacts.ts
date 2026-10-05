/**
 * R9 / SEM-043 — Repositório do LEDGER APPEND-ONLY dos artefatos renderizados (DOCX/PDF) de `official_documents`.
 *
 * Cada export registra QUAIS bytes saíram (sha256 do binário), de QUAL conteúdo/replay e por QUEM. Contrato:
 *  - INSERT puro com UNIQUE(tenant, documento, formato, hash): bytes idênticos ⇒ duplicado capturado ⇒ devolve a linha
 *    EXISTENTE (`created: false`); bytes diferentes no mesmo formato ⇒ nova linha; formatos distintos nunca colidem;
 *  - NUNCA atualiza/deleta (não há função de UPDATE/DELETE neste módulo — travado por teste estático);
 *  - toda leitura/escrita é tenant-scoped; aceita executor (transação do chamador, ver `recordOfficialArtifact`);
 *  - sem DB (dev): degrada (`null`), como os demais repositórios do documento oficial.
 */
import { createHash } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { officialDocumentArtifactsTable } from "../../drizzle/schema";
import type { OfficialDocsExecutor } from "./officialDocuments";

export interface OfficialDocumentArtifact {
  readonly id: string;
  readonly tenantId: number;
  readonly documentId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly format: string;
  /** sha256 dos BYTES renderizados. */
  readonly artifactHash: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  /** Vazio no caminho de desenvolvimento (base64, sem storage). */
  readonly storageKey: string;
  /** sha256 de `official_documents.content` no momento do export. */
  readonly sourceContentHash: string;
  /** `replay_hash` da versão exportada. */
  readonly sourceReplayHash: string;
  /** Fingerprint da identidade institucional aplicada ao cabeçalho ("" quando não disponível). */
  readonly identityFingerprint: string;
  readonly correlationId: string;
  /** Ator humano `user:<id>`. */
  readonly createdBy: string;
  readonly createdAt: string;
}

export type NewOfficialDocumentArtifact = Omit<OfficialDocumentArtifact, "id" | "createdAt">;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Id determinístico por artefato (tenant + documento + formato + hash dos bytes) — mesma entrada, mesmo id. */
export function computeArtifactId(a: Pick<NewOfficialDocumentArtifact, "tenantId" | "documentId" | "format" | "artifactHash">): string {
  return createHash("sha256").update(`oda:${a.tenantId}:${a.documentId}:${a.format}:${a.artifactHash}`).digest("hex").slice(0, 24);
}

/** ER_DUP_ENTRY (1062), inclusive encapsulado pelo driver/drizzle. Privado do módulo (o `db/index.ts` re-exporta `*`). */
function isDuplicateKey(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const x = e as { code?: string; errno?: number; cause?: unknown };
    if (x.code === "ER_DUP_ENTRY" || x.errno === 1062) return true;
    e = x.cause;
  }
  return false;
}

function rowToArtifact(r: typeof officialDocumentArtifactsTable.$inferSelect): OfficialDocumentArtifact {
  return {
    id: r.id, tenantId: r.tenantId, documentId: r.documentId, lineageId: r.lineageId, version: r.version,
    format: r.format, artifactHash: r.artifactHash, sizeBytes: r.sizeBytes, mimeType: r.mimeType,
    storageKey: r.storageKey, sourceContentHash: r.sourceContentHash, sourceReplayHash: r.sourceReplayHash,
    identityFingerprint: r.identityFingerprint, correlationId: r.correlationId, createdBy: r.createdBy, createdAt: r.createdAt,
  };
}

/** Linha do ledger por (tenant, documento, formato, hash) — a chave UNIQUE. */
export async function getOfficialDocumentArtifactByHash(
  tenantId: number, documentId: string, format: string, artifactHash: string, executor?: OfficialDocsExecutor,
): Promise<OfficialDocumentArtifact | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const rows = await db.select().from(officialDocumentArtifactsTable).where(and(
    eq(officialDocumentArtifactsTable.tenantId, tenantId), eq(officialDocumentArtifactsTable.documentId, documentId),
    eq(officialDocumentArtifactsTable.format, format), eq(officialDocumentArtifactsTable.artifactHash, artifactHash),
  )).limit(1);
  return rows.length ? rowToArtifact(rows[0]) : null;
}

/**
 * INSERT PURO no ledger. Duplicado (mesmos bytes, mesmo formato, mesmo documento, mesmo tenant) ⇒ NO-OP que devolve a
 * linha existente (`created: false`). Qualquer outro erro propaga (fail-closed). Sem DB ⇒ `null`.
 */
export async function insertOfficialDocumentArtifact(
  rec: NewOfficialDocumentArtifact, executor?: OfficialDocsExecutor,
): Promise<{ artifact: OfficialDocumentArtifact; created: boolean } | null> {
  const db = executor ?? await getDb();
  if (!db) return null;
  const id = computeArtifactId(rec);
  try {
    await db.insert(officialDocumentArtifactsTable).values({
      id, tenantId: rec.tenantId, documentId: rec.documentId, lineageId: rec.lineageId, version: rec.version,
      format: rec.format, artifactHash: rec.artifactHash, sizeBytes: rec.sizeBytes, mimeType: rec.mimeType,
      storageKey: rec.storageKey, sourceContentHash: rec.sourceContentHash, sourceReplayHash: rec.sourceReplayHash,
      identityFingerprint: rec.identityFingerprint, correlationId: rec.correlationId, createdBy: rec.createdBy,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existing = await getOfficialDocumentArtifactByHash(rec.tenantId, rec.documentId, rec.format, rec.artifactHash, executor);
    if (!existing) throw err; // duplicado em outra chave que não a de leitura: estado inesperado → fail-closed
    return { artifact: existing, created: false };
  }
  const row = await getOfficialDocumentArtifactByHash(rec.tenantId, rec.documentId, rec.format, rec.artifactHash, executor);
  if (!row) throw new Error("OFFICIAL_ARTIFACT_LEDGER_READBACK_FAILED: o artefato inserido não pôde ser relido.");
  return { artifact: row, created: true };
}

/** Artefatos de um documento oficial (todas as exportações, todos os formatos), tenant-scoped, mais antigo → mais novo. */
export async function listOfficialDocumentArtifacts(tenantId: number, documentId: string): Promise<OfficialDocumentArtifact[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(officialDocumentArtifactsTable)
    .where(and(eq(officialDocumentArtifactsTable.tenantId, tenantId), eq(officialDocumentArtifactsTable.documentId, documentId)))
    .orderBy(asc(officialDocumentArtifactsTable.createdAt), asc(officialDocumentArtifactsTable.id));
  return rows.map(rowToArtifact);
}
