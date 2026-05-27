/**
 * Sprint 2.5 — Document Integrity Strategy.
 *
 * Anti-tampering, fingerprinting e validação de integridade jurídica.
 * Especialmente para: parecer, edital, contrato, aditivo.
 */
import { createHash } from "crypto";
import type { StructuredDocumentContent } from "./documentTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrityRecord {
  contentHash:         string; // SHA-256 do conteúdo textual
  snapshotFingerprint: string; // SHA-256 do snapshot completo (deterministicamente ordenado)
  computedAt:          string; // ISO timestamp
}

export interface IntegrityValidationResult {
  valid:               boolean;
  contentHashMatch:    boolean;
  fingerprintMatch:    boolean;
  reason?:             string;
  tamperedFields?:     string[];
}

// ─── Hash functions ───────────────────────────────────────────────────────────

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Computa o fingerprint canônico do snapshot.
 * Determinístico: ordenação de chaves JSON garantida.
 */
export function computeSnapshotFingerprint(
  documentId:        number,
  organizationId:    number,
  content:           string | null,
  structuredContent: StructuredDocumentContent | null,
  version:           number,
): string {
  const payload = JSON.stringify({
    documentId,
    organizationId,
    content:          content          ?? "",
    structuredContent: structuredContent ?? null,
    version,
  }, (_key, value) => {
    // Ordenação determinística de objetos
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort());
    }
    return value;
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function computeRenderChecksum(renderedHtml: string): string {
  return createHash("sha256").update(renderedHtml, "utf8").digest("hex");
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateIntegrity(
  expected: Pick<IntegrityRecord, "contentHash" | "snapshotFingerprint">,
  actual: {
    content:           string | null;
    structuredContent: StructuredDocumentContent | null;
    documentId:        number;
    organizationId:    number;
    version:           number;
  },
): IntegrityValidationResult {
  const actualContentHash  = hashContent(actual.content ?? "");
  const actualFingerprint  = computeSnapshotFingerprint(
    actual.documentId,
    actual.organizationId,
    actual.content,
    actual.structuredContent,
    actual.version,
  );

  const contentHashMatch   = expected.contentHash         === actualContentHash;
  const fingerprintMatch   = expected.snapshotFingerprint === actualFingerprint;
  const tamperedFields: string[] = [];

  if (!contentHashMatch)  tamperedFields.push("content");
  if (!fingerprintMatch)  tamperedFields.push("snapshotFingerprint");

  return {
    valid:             contentHashMatch && fingerprintMatch,
    contentHashMatch,
    fingerprintMatch,
    reason:            tamperedFields.length > 0
      ? `Integridade comprometida nos campos: ${tamperedFields.join(", ")}.`
      : undefined,
    tamperedFields:    tamperedFields.length > 0 ? tamperedFields : undefined,
  };
}

export function buildIntegrityRecord(
  documentId:        number,
  organizationId:    number,
  content:           string | null,
  structuredContent: StructuredDocumentContent | null,
  version:           number,
): IntegrityRecord {
  return {
    contentHash:         hashContent(content ?? ""),
    snapshotFingerprint: computeSnapshotFingerprint(documentId, organizationId, content, structuredContent, version),
    computedAt:          new Date().toISOString(),
  };
}
