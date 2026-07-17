/**
 * RC-4.8 — Institutional Knowledge Pipeline · Publication Engine (Fase 6).
 *
 * KnowledgePublisher, PublicationContext, PublicationManifest, PublicationVersion,
 * PublicationSnapshot e PublicationHistory. Publicação só ocorre se os quality gates passarem.
 * Append-only, imutável, replay-safe, determinístico. Sem conteúdo jurídico.
 */

import { createHash } from "crypto";
import type { KnowledgeDocument } from "../knowledgeDocument";
import { evaluateQualityGates, type QualityGateResult, type QualityProfile } from "./qualityGates";

export interface PublicationContext {
  readonly tenantId: number;
  readonly correlationId: string;
  readonly document: KnowledgeDocument;
  readonly approvedBy: string;
  readonly reason: string;
  readonly bindingConsistent?: boolean;
  /** Perfil de quality gate ("official_norm" p/ documentos oficiais verbatim — RC-4.9). */
  readonly profile?: QualityProfile;
  readonly publishedAt?: string;
}

export interface PublicationManifest {
  readonly manifestId: string;
  readonly docId: string;
  readonly docKey: string;
  readonly semver: string;
  readonly revision: number;
  readonly lineageId: string;
  readonly checksum: string;
  readonly approvedBy: string;
  readonly reason: string;
}

export interface PublicationVersion {
  readonly semver: string;
  readonly revision: number;
}

export interface PublicationSnapshot {
  readonly snapshotId: string;
  readonly tenantId: number;
  readonly manifest: PublicationManifest;
  readonly version: PublicationVersion;
  readonly gates: QualityGateResult;
  readonly publishedAt: string;
  readonly replayHash: string;
}

export interface PublicationHistory {
  readonly snapshots: readonly PublicationSnapshot[];
}

export interface PublishOutcome {
  readonly published: boolean;
  readonly snapshot: PublicationSnapshot | null;
  readonly gates: QualityGateResult;
}

export const KnowledgePublisher = {
  /**
   * Publica um documento SE os quality gates passarem. Determinístico. Nunca sobrescreve —
   * gera um snapshot imutável. Se os gates falharem, retorna `published: false` (sem snapshot).
   */
  publish(context: PublicationContext): PublishOutcome {
    const gates = evaluateQualityGates({ document: context.document, bindingConsistent: context.bindingConsistent, profile: context.profile });
    if (!gates.passed) return { published: false, snapshot: null, gates };

    const doc = context.document;
    const checksum = createHash("sha256").update(doc.replayHash).digest("hex");
    const manifestId = createHash("sha256").update(`pmanifest:${doc.id}:${doc.revision}`).digest("hex").slice(0, 20);
    const manifest: PublicationManifest = {
      manifestId, docId: doc.id, docKey: doc.docKey, semver: doc.semver, revision: doc.revision,
      lineageId: doc.lineageId, checksum, approvedBy: context.approvedBy, reason: context.reason,
    };
    const replayHash = createHash("sha256").update(JSON.stringify({
      tenant: context.tenantId, doc: doc.replayHash, semver: doc.semver, revision: doc.revision,
      approvedBy: context.approvedBy, checksum,
    })).digest("hex").slice(0, 32);
    const snapshotId = createHash("sha256").update(`psnap:${doc.lineageId}:${doc.revision}`).digest("hex").slice(0, 20);
    const snapshot: PublicationSnapshot = {
      snapshotId, tenantId: context.tenantId, manifest, version: { semver: doc.semver, revision: doc.revision },
      gates, publishedAt: context.publishedAt ?? doc.updatedAt, replayHash,
    };
    return { published: true, snapshot, gates };
  },
};

export function createPublicationHistory(snapshots: PublicationSnapshot[] = []): PublicationHistory {
  const sorted = [...snapshots].sort((a, b) => a.manifest.revision - b.manifest.revision || a.snapshotId.localeCompare(b.snapshotId));
  return { snapshots: sorted };
}

/** Adiciona um snapshot ao histórico (append-only; idempotente por snapshotId). */
export function addSnapshot(history: PublicationHistory, snapshot: PublicationSnapshot): PublicationHistory {
  if (history.snapshots.some(s => s.snapshotId === snapshot.snapshotId)) return history;
  return createPublicationHistory([...history.snapshots, snapshot]);
}

export function latestSnapshot(history: PublicationHistory): PublicationSnapshot | null {
  return history.snapshots.length ? history.snapshots[history.snapshots.length - 1] : null;
}
