/**
 * Sprint 2.5 — Document Integrity Service.
 *
 * Computa e valida hashes/fingerprints de documentos e versões.
 * Anti-tampering: detecta adulteração entre o momento de escrita e leitura.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documents, documentVersions } from "../../drizzle/schema";
import {
  hashContent,
  computeSnapshotFingerprint,
  validateIntegrity,
  buildIntegrityRecord,
} from "../domain/documentIntegrity";
import { serviceLogger } from "./observabilityService";
import type { StructuredDocumentContent } from "../domain/documentTypes";
import type { IntegrityValidationResult } from "../domain/documentIntegrity";

const log = serviceLogger("DocumentIntegrityService");

// ─── Compute & store ──────────────────────────────────────────────────────────

export async function computeAndStoreIntegrity(
  documentId:     number,
  organizationId: number,
): Promise<{ contentHash: string; snapshotFingerprint: string }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = rows[0];
  const record = buildIntegrityRecord(
    doc.id,
    doc.organizationId!,
    doc.content ?? null,
    doc.structuredContent as StructuredDocumentContent | null,
    doc.version,
  );

  await db.update(documents).set({
    contentHash:         record.contentHash,
    snapshotFingerprint: record.snapshotFingerprint,
  }).where(eq(documents.id, documentId));

  log.debug("integrity_computed", { documentId, organizationId });
  return { contentHash: record.contentHash, snapshotFingerprint: record.snapshotFingerprint };
}

// ─── Validate ─────────────────────────────────────────────────────────────────

export async function validateDocumentIntegrity(
  documentId:     number,
  organizationId: number,
): Promise<IntegrityValidationResult> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const rows = await db.select().from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
    .limit(1);

  if (rows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado." });

  const doc = rows[0];

  if (!doc.contentHash || !doc.snapshotFingerprint) {
    return {
      valid:            false,
      contentHashMatch: false,
      fingerprintMatch: false,
      reason:           "Integridade não foi computada para este documento.",
    };
  }

  const result = validateIntegrity(
    { contentHash: doc.contentHash, snapshotFingerprint: doc.snapshotFingerprint },
    {
      content:           doc.content ?? null,
      structuredContent: doc.structuredContent as StructuredDocumentContent | null,
      documentId:        doc.id,
      organizationId:    doc.organizationId!,
      version:           doc.version,
    },
  );

  log.info("integrity_validated", {
    documentId,
    organizationId,
    valid:   result.valid,
    tampered: !result.valid,
  });

  return result;
}

// ─── Version fingerprint ──────────────────────────────────────────────────────

export async function computeAndStoreVersionFingerprint(
  versionId:      number,
  organizationId: number,
): Promise<string> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const rows = await db.select().from(documentVersions)
    .where(and(
      eq(documentVersions.id,             versionId),
      eq(documentVersions.organizationId, organizationId),
    ))
    .limit(1);

  if (rows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: "Versão não encontrada." });

  const v = rows[0];
  const fingerprint = computeSnapshotFingerprint(
    v.documentId,
    v.organizationId,
    v.contentSnapshot    ?? null,
    v.structuredSnapshot as StructuredDocumentContent | null,
    v.versionNumber,
  );

  await db.update(documentVersions)
    .set({ snapshotFingerprint: fingerprint })
    .where(eq(documentVersions.id, versionId));

  log.debug("version_fingerprint_computed", { versionId, organizationId });
  return fingerprint;
}

// ─── Batch validation helper ──────────────────────────────────────────────────

export function isIntegrityComputed(doc: { contentHash?: string | null; snapshotFingerprint?: string | null }): boolean {
  return !!(doc.contentHash && doc.snapshotFingerprint);
}
