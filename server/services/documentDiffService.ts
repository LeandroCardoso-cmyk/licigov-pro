/**
 * Sprint 2.5 — Document Diff Service.
 *
 * Compara versões de documentos e armazena o diff em diffMetadata.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { documentVersions } from "../../drizzle/schema";
import { computeDiff } from "../domain/documentDiff";
import { serviceLogger } from "./observabilityService";
import type { DocumentDiff } from "../domain/documentDiff";
import type { StructuredDocumentContent } from "../domain/documentTypes";

const log = serviceLogger("DocumentDiffService");

export async function diffVersions(
  documentId:        number,
  organizationId:    number,
  fromVersionNumber: number,
  toVersionNumber:   number,
): Promise<DocumentDiff> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

  const [fromRows, toRows] = await Promise.all([
    db.select().from(documentVersions)
      .where(and(
        eq(documentVersions.documentId,     documentId),
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.versionNumber,  fromVersionNumber),
      ))
      .limit(1),
    db.select().from(documentVersions)
      .where(and(
        eq(documentVersions.documentId,     documentId),
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.versionNumber,  toVersionNumber),
      ))
      .limit(1),
  ]);

  if (fromRows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: `Versão ${fromVersionNumber} não encontrada.` });
  if (toRows.length === 0)
    throw new TRPCError({ code: "NOT_FOUND", message: `Versão ${toVersionNumber} não encontrada.` });

  const from = fromRows[0];
  const to   = toRows[0];

  const diff = computeDiff(
    documentId,
    organizationId,
    fromVersionNumber,
    toVersionNumber,
    from.contentSnapshot ?? null,
    to.contentSnapshot   ?? null,
    from.structuredSnapshot as StructuredDocumentContent | null,
    to.structuredSnapshot   as StructuredDocumentContent | null,
  );

  // Persiste diff metadata na versão destino
  try {
    await db.update(documentVersions)
      .set({ diffMetadata: diff as unknown as Record<string, unknown> })
      .where(eq(documentVersions.id, to.id));
  } catch {
    log.warn("diff_metadata_save_failed", { documentId, toVersionNumber });
  }

  log.info("diff_computed", {
    documentId,
    fromVersionNumber,
    toVersionNumber,
    severity: diff.summary.severity,
    organizationId,
  });

  return diff;
}

export async function getStoredDiff(
  documentId:      number,
  organizationId:  number,
  versionNumber:   number,
): Promise<DocumentDiff | null> {
  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(documentVersions)
    .where(and(
      eq(documentVersions.documentId,     documentId),
      eq(documentVersions.organizationId, organizationId),
      eq(documentVersions.versionNumber,  versionNumber),
    ))
    .limit(1);

  if (rows.length === 0 || !rows[0].diffMetadata) return null;
  return rows[0].diffMetadata as unknown as DocumentDiff;
}
