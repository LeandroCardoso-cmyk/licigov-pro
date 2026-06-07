import { createHash } from "crypto";

export type EvidenceType =
  | "legal_clause"
  | "justification"
  | "precedent"
  | "catmat_ref"
  | "operational_history"
  | "approval_record"
  | "rejection_record"
  | "audit_trail";

export type EvidenceStatus = "active" | "superseded" | "archived" | "disputed";

export interface EvidenceItem {
  id: string;
  organizationId: number;
  evidenceType: EvidenceType;
  content: string;
  sourceRef: string;
  legalBasis: string | null;
  confidence: number;
  relevanceScore: number;
  citationKey: string;
  status: EvidenceStatus;
  provenance: string[];
  immutable: boolean;
  createdAt: string;
}

export interface EvidenceChain {
  id: string;
  organizationId: number;
  sessionId: string;
  query: string;
  evidenceItems: EvidenceItem[];
  totalEvidence: number;
  avgConfidence: number;
  chainExplanation: string;
  replayKey: string;
  assembledAt: string;
}

const _evidenceStore = new Map<number, EvidenceItem[]>();

function sha20(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

export function createEvidenceItem(params: {
  organizationId: number;
  evidenceType: EvidenceType;
  content: string;
  sourceRef: string;
  legalBasis?: string;
  confidence: number;
  relevanceScore: number;
  citationKey?: string;
  provenance?: string[];
}): EvidenceItem {
  const now = new Date().toISOString();
  const citationKey =
    params.citationKey ??
    createHash("sha256")
      .update(params.sourceRef + params.content)
      .digest("hex")
      .slice(0, 12);

  const id = sha20(
    `${params.organizationId}${params.evidenceType}${params.sourceRef}${params.content}${now}`
  );

  const item: EvidenceItem = {
    id,
    organizationId: params.organizationId,
    evidenceType: params.evidenceType,
    content: params.content,
    sourceRef: params.sourceRef,
    legalBasis: params.legalBasis ?? null,
    confidence: Math.min(1, Math.max(0, params.confidence)),
    relevanceScore: Math.min(1, Math.max(0, params.relevanceScore)),
    citationKey,
    status: "active",
    provenance: params.provenance ?? [],
    immutable: true,
    createdAt: now,
  };

  const store = _evidenceStore.get(params.organizationId) ?? [];
  store.push(item);
  _evidenceStore.set(params.organizationId, store);

  return item;
}

export function assembleEvidenceChain(params: {
  organizationId: number;
  sessionId: string;
  query: string;
  evidenceRefs: EvidenceItem[];
  maxItems?: number;
}): EvidenceChain {
  const maxItems = params.maxItems ?? 10;
  const now = new Date().toISOString();

  const active = params.evidenceRefs
    .filter((e) => e.status === "active")
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxItems);

  const avgConfidence =
    active.length === 0
      ? 0
      : active.reduce((sum, e) => sum + e.confidence, 0) / active.length;

  const replayKey = sha20(
    params.query +
      params.sessionId +
      active
        .map((e) => e.id)
        .sort()
        .join("")
  );

  const chainId = sha20(`${params.organizationId}${params.sessionId}${replayKey}`);

  return {
    id: chainId,
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    query: params.query,
    evidenceItems: active,
    totalEvidence: active.length,
    avgConfidence,
    chainExplanation: `Cadeia de ${active.length} evidências para: ${params.query}`,
    replayKey,
    assembledAt: now,
  };
}

export function rankByProvenance(chain: EvidenceChain): EvidenceChain {
  const sorted = [...chain.evidenceItems].sort((a, b) => {
    const diff = b.provenance.length - a.provenance.length;
    if (diff !== 0) return diff;
    return b.confidence - a.confidence;
  });
  return { ...chain, evidenceItems: sorted };
}

export function buildCitationList(chain: EvidenceChain): string[] {
  return chain.evidenceItems.map((e) => {
    const legal = e.legalBasis ? ` — ${e.legalBasis}` : "";
    return `[${e.citationKey}] ${e.sourceRef}${legal}`;
  });
}

export function supersede(
  oldEvidence: EvidenceItem,
  newEvidence: EvidenceItem
): { old: EvidenceItem; new: EvidenceItem } {
  const supersededOld: EvidenceItem = { ...oldEvidence, status: "superseded" };

  const store = _evidenceStore.get(oldEvidence.organizationId) ?? [];
  const updatedStore = store.map((e) =>
    e.id === oldEvidence.id ? supersededOld : e
  );
  _evidenceStore.set(oldEvidence.organizationId, updatedStore);

  const updatedNew: EvidenceItem = {
    ...newEvidence,
    provenance: [...newEvidence.provenance, oldEvidence.id],
  };

  const newStore = _evidenceStore.get(newEvidence.organizationId) ?? [];
  const updatedNewStore = newStore.map((e) =>
    e.id === newEvidence.id ? updatedNew : e
  );
  _evidenceStore.set(newEvidence.organizationId, updatedNewStore);

  return { old: supersededOld, new: updatedNew };
}
