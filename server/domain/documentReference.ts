/**
 * Kernel — Document Reference
 *
 * Documentos NUNCA são copiados entre domínios — sempre referenciados. Uma
 * DocumentReference aponta para o documento de origem (domínio, id, versão) com
 * um snapshot determinístico para rastreabilidade/replay. Sem download, sem upload.
 */

import { createHash } from "crypto";
import type { BusinessDomainCode } from "./institutionalRequest";

export interface DocumentReference {
  readonly id: string;
  readonly organizationId: number;
  readonly requestId: string;
  readonly originDomain: BusinessDomainCode;
  readonly documentId: string;
  readonly version: number;
  readonly snapshot: string;
  readonly title: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createDocumentReference(params: {
  organizationId: number;
  requestId: string;
  originDomain: BusinessDomainCode;
  documentId: string;
  version?: number;
  title?: string;
  /** Conteúdo canônico para snapshot (o documento NÃO é copiado; só o hash). */
  snapshotSource?: string;
  correlationId: string;
  createdAt?: string;
}): DocumentReference {
  const version = params.version ?? 1;
  const id = createHash("sha256")
    .update(`docref:${params.organizationId}:${params.requestId}:${params.originDomain}:${params.documentId}:${version}`)
    .digest("hex").slice(0, 20);
  const snapshot = createHash("sha256")
    .update(`snap:${params.originDomain}:${params.documentId}:${version}:${params.snapshotSource ?? ""}`)
    .digest("hex").slice(0, 32);
  return {
    id,
    organizationId: params.organizationId,
    requestId: params.requestId,
    originDomain: params.originDomain,
    documentId: params.documentId,
    version,
    snapshot,
    title: params.title ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Verifica se um snapshot corresponde ao estado atual do documento referenciado. */
export function verifySnapshot(ref: DocumentReference, snapshotSource: string): boolean {
  const expected = createHash("sha256")
    .update(`snap:${ref.originDomain}:${ref.documentId}:${ref.version}:${snapshotSource}`)
    .digest("hex").slice(0, 32);
  return expected === ref.snapshot;
}
