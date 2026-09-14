/**
 * A3-RD1 — Acesso GOVERNADO ao domínio de referência jurídica (Lei 14.133/2021).
 *
 * Instala (replay-safe, INSERT/no-op/fail-closed por hash), resolve (readiness temporal
 * fail-closed) e aprova/ativa (mutação de lifecycle auditada). Instalar ≠ ativar: o set
 * nasce `draft`. Escopo GLOBAL/BR-FEDERAL (não-tenant). Contrato: F-LEGAL1.1/F-LEGAL1.2.
 */
import { and, eq } from "drizzle-orm";
import {
  legalReferenceSets, legalReferenceEntries, legalValueOverrides, legalReferenceSetEvents,
  type LegalReferenceSet, type LegalReferenceEntry, type LegalValueOverride,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import {
  LEGAL_REFERENCE_V1_META, LEGAL_REFERENCE_V1_ENTRIES, LEGAL_REFERENCE_V1_OVERRIDES,
  coverageManifestObject, computeManifestHashes,
} from "../domain/legalReference/manifestV1";
import {
  LegalReferenceError, resolveExactlyOne, isLocatorSupported, windowContains,
  type CoverageManifestShape,
} from "../domain/legalReference/readiness";

const M = LEGAL_REFERENCE_V1_META;

// ─── Instalação replay-safe (INSERT / no-op / fail-closed por hash) ───────────────

export interface InstallResult {
  readonly action: "installed" | "noop" | "skipped";
  readonly reason?: string;
  readonly setId?: number;
  readonly referenceSetContentHash: string;
}

/**
 * Instala o reference set V1 como `draft` (nunca ativa). Replay-safe:
 *  - set inexistente → INSERT (set + entries + overrides + evento) em transação;
 *  - mesma (law,jurisdiction,version) + mesmo contentHash + mesmas contagens → NO-OP (replay válido);
 *  - mesma versão + hash/contagem divergente → FAIL-CLOSED (LEGAL_REFERENCE_CONTENT_HASH_INVALID).
 * Mudança jurídica futura = nova versão (nunca reescrita in place).
 */
export async function installGovernedLegalReferenceV1(): Promise<InstallResult> {
  const db = await getDb();
  const hashes = computeManifestHashes();
  if (!db) return { action: "skipped", reason: "no-db", referenceSetContentHash: hashes.referenceSetContentHash };

  const existing = await db.select().from(legalReferenceSets).where(and(
    eq(legalReferenceSets.law, M.law),
    eq(legalReferenceSets.jurisdiction, M.jurisdiction),
    eq(legalReferenceSets.version, M.version),
  )).limit(1);

  if (existing.length > 0) {
    const set = existing[0];
    const entries = await db.select().from(legalReferenceEntries).where(eq(legalReferenceEntries.setId, set.id));
    const overrides = await db.select().from(legalValueOverrides).where(eq(legalValueOverrides.setId, set.id));
    const sameContent =
      set.contentHash === hashes.referenceSetContentHash &&
      set.coverageManifestHash === hashes.coverageManifestHash &&
      entries.length === LEGAL_REFERENCE_V1_ENTRIES.length &&
      overrides.length === LEGAL_REFERENCE_V1_OVERRIDES.length &&
      entries.every((e) => hashes.entryHashes[e.canonicalLocator] === e.contentHash) &&
      overrides.every((o) => hashes.overrideHashes[o.canonicalLocator] === o.contentHash);
    if (sameContent) return { action: "noop", setId: set.id, referenceSetContentHash: hashes.referenceSetContentHash };
    throw new LegalReferenceError(
      "LEGAL_REFERENCE_CONTENT_HASH_INVALID",
      `Reference set ${M.law} v${M.version} já instalado com conteúdo divergente — instalação abortada (mudança jurídica exige NOVA versão, nunca reescrita).`,
    );
  }

  const coverage = coverageManifestObject();
  const setId = await db.transaction(async (tx) => {
    const insertedSet = await tx.insert(legalReferenceSets).values({
      law: M.law, jurisdiction: M.jurisdiction, scope: M.scope, version: M.version,
      status: "draft",
      coverageManifest: coverage,
      coverageManifestHash: hashes.coverageManifestHash,
      contentHash: hashes.referenceSetContentHash,
      effectiveFrom: M.effectiveFrom, effectiveTo: M.effectiveTo,
      sourceAuthority: M.law_source.authority, sourceIdentifier: M.law_source.identifier,
      verificationMethod: M.verificationMethod,
    });
    const newSetId = insertedSet[0].insertId;

    for (const e of LEGAL_REFERENCE_V1_ENTRIES) {
      await tx.insert(legalReferenceEntries).values({
        setId: newSetId, law: M.law, article: e.article, inciso: e.inciso, alinea: e.alinea,
        canonicalLocator: e.canonicalLocator, canonicalDisplay: e.canonicalDisplay,
        procurementType: e.procurementType, hypothesisSummary: e.hypothesisSummary,
        sourceAuthority: M.law_source.authority, sourceIdentifier: M.law_source.identifier,
        sourceUrl: M.law_source.url, publicationDate: M.law_source.publicationDate,
        contentHash: hashes.entryHashes[e.canonicalLocator],
      });
    }
    for (const o of LEGAL_REFERENCE_V1_OVERRIDES) {
      await tx.insert(legalValueOverrides).values({
        setId: newSetId, canonicalLocator: o.canonicalLocator, valueCents: o.valueCents,
        effectiveFrom: M.effectiveFrom, effectiveTo: M.effectiveTo,
        sourceAuthority: M.decree_source.authority, sourceIdentifier: M.decree_source.identifier,
        sourceUrl: M.decree_source.url, publicationDate: M.decree_source.publicationDate,
        contentHash: hashes.overrideHashes[o.canonicalLocator],
      });
    }
    await tx.insert(legalReferenceSetEvents).values({
      setId: newSetId, action: "installed", fromStatus: null, toStatus: "draft",
      approvedReferenceHash: null,
      details: { referenceSetContentHash: hashes.referenceSetContentHash, entries: LEGAL_REFERENCE_V1_ENTRIES.length, overrides: LEGAL_REFERENCE_V1_OVERRIDES.length },
    });
    return newSetId;
  });

  return { action: "installed", setId, referenceSetContentHash: hashes.referenceSetContentHash };
}

// ─── Getters governados ───────────────────────────────────────────────────────

export async function getReferenceSetsByLaw(law: string, jurisdiction: string): Promise<LegalReferenceSet[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(legalReferenceSets).where(and(
    eq(legalReferenceSets.law, law), eq(legalReferenceSets.jurisdiction, jurisdiction),
  ));
}

export async function getReferenceEntries(setId: number): Promise<LegalReferenceEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(legalReferenceEntries).where(eq(legalReferenceEntries.setId, setId));
}

export async function getReferenceOverrides(setId: number): Promise<LegalValueOverride[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(legalValueOverrides).where(eq(legalValueOverrides.setId, setId));
}

// ─── Readiness / resolução (fail-closed, exatamente-um) ───────────────────────────

export interface ResolvedActiveSet {
  readonly set: LegalReferenceSet;
  readonly coverage: CoverageManifestShape;
}

/**
 * Resolve o ÚNICO set `active` aprovado e íntegro vigente em `asOfDate` para law/jurisdiction.
 * Fail-closed: ausência → SET_MISSING; múltiplos vigentes → TEMPORAL_OVERLAP; não aprovado →
 * SET_NOT_APPROVED; hash de aprovação divergente → CONTENT_HASH_INVALID; vazio → EMPTY.
 */
export async function resolveActiveReferenceSet(
  asOfDate: string, law: string = M.law, jurisdiction: string = M.jurisdiction,
): Promise<ResolvedActiveSet> {
  const all = await getReferenceSetsByLaw(law, jurisdiction);
  const active = all.filter((s) => s.status === "active");
  if (active.length === 0) throw new LegalReferenceError("LEGAL_REFERENCE_SET_MISSING", `Nenhum reference set ativo para ${law}/${jurisdiction}.`);
  const set = resolveExactlyOne(
    active.map((s) => ({ ...s, effectiveTo: s.effectiveTo ?? null })),
    asOfDate, "LEGAL_REFERENCE_VERSION_GAP", "LEGAL_REFERENCE_TEMPORAL_OVERLAP",
  ) as LegalReferenceSet;

  if (!set.approvedReferenceHash || !set.approvedByUserId) {
    throw new LegalReferenceError("LEGAL_REFERENCE_SET_NOT_APPROVED", `Reference set v${set.version} não aprovado.`);
  }
  if (set.approvedReferenceHash !== set.contentHash) {
    throw new LegalReferenceError("LEGAL_REFERENCE_CONTENT_HASH_INVALID", `Reference set v${set.version}: approvedReferenceHash ≠ contentHash.`);
  }
  const entries = await getReferenceEntries(set.id);
  if (entries.length === 0) throw new LegalReferenceError("LEGAL_REFERENCE_EMPTY", `Reference set v${set.version} sem entries.`);

  const coverage = (set.coverageManifest ?? {}) as CoverageManifestShape;
  return { set, coverage };
}

export interface ResolvedReference {
  readonly referenceSetVersion: number;
  readonly setId: number;
  readonly entry: LegalReferenceEntry;
  readonly valueCents: number | null;
}

/**
 * Resolve um locator canônico dentro do set ativo, na data. Distingue UNSUPPORTED (fora da
 * cobertura) de NOT_FOUND (defeito de dados). Value override resolvido exatamente-um quando existir.
 */
export async function resolveGovernedReference(canonicalLocator: string, asOfDate: string): Promise<ResolvedReference> {
  const { set, coverage } = await resolveActiveReferenceSet(asOfDate);
  if (!isLocatorSupported(coverage, canonicalLocator)) {
    throw new LegalReferenceError("LEGAL_REFERENCE_UNSUPPORTED", `Locator fora da cobertura V1: ${canonicalLocator}.`);
  }
  const entries = await getReferenceEntries(set.id);
  const matched = entries.filter((e) => e.canonicalLocator === canonicalLocator);
  if (matched.length === 0) throw new LegalReferenceError("LEGAL_REFERENCE_NOT_FOUND", `Locator na cobertura mas ausente nos dados: ${canonicalLocator}.`);
  if (matched.length > 1) throw new LegalReferenceError("LEGAL_REFERENCE_AMBIGUOUS", `Locator duplicado no set: ${canonicalLocator}.`);
  const entry = matched[0];

  const overrides = (await getReferenceOverrides(set.id)).filter((o) => o.canonicalLocator === canonicalLocator);
  let valueCents: number | null = null;
  if (overrides.length > 0) {
    const chosen = resolveExactlyOne(
      overrides.map((o) => ({ ...o, effectiveTo: o.effectiveTo ?? null })),
      asOfDate, "LEGAL_VALUE_OVERRIDE_MISSING", "LEGAL_REFERENCE_TEMPORAL_OVERLAP",
    ) as LegalValueOverride;
    valueCents = chosen.valueCents;
  }
  return { referenceSetVersion: set.version, setId: set.id, entry, valueCents };
}

/** Snapshot governado (entries + overrides + valor resolvido) para montar o prompt do Kernel. */
export interface GovernedCatalogItem {
  readonly canonicalLocator: string;
  readonly canonicalDisplay: string;
  readonly procurementType: "dispensa" | "inexigibilidade";
  readonly hypothesisSummary: string;
  readonly valueCents: number | null;
  readonly legalReferenceEntryId: number;
}

/** Catálogo governado vigente na data (para o assistente) — fail-closed via resolveActiveReferenceSet. */
export async function getGovernedCatalog(asOfDate: string): Promise<{ referenceSetVersion: number; setId: number; items: GovernedCatalogItem[] }> {
  const { set } = await resolveActiveReferenceSet(asOfDate);
  const entries = await getReferenceEntries(set.id);
  const overrides = await getReferenceOverrides(set.id);
  const items: GovernedCatalogItem[] = entries.map((e) => {
    const locOverrides = overrides.filter((o) => o.canonicalLocator === e.canonicalLocator && windowContains({ effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo ?? null }, asOfDate));
    return {
      canonicalLocator: e.canonicalLocator, canonicalDisplay: e.canonicalDisplay,
      procurementType: e.procurementType, hypothesisSummary: e.hypothesisSummary,
      valueCents: locOverrides.length === 1 ? locOverrides[0].valueCents : null,
      legalReferenceEntryId: e.id,
    };
  });
  return { referenceSetVersion: set.version, setId: set.id, items };
}

// ─── Aprovação / ativação (mutação de lifecycle auditada) — NÃO executada nesta fase ──────

export interface ApproveActivateInput {
  readonly law?: string;
  readonly jurisdiction?: string;
  readonly version: number;
  readonly expectedReferenceHash: string;
  readonly actorUserId: number;
  readonly actorRole?: string;
  readonly approvalSource: string;
  readonly correlationId?: string;
}

/**
 * Aprova e ATIVA o reference set (platform-level, ator humano identificado). Fail-closed se:
 * hash recebido ≠ instalado; set inexistente/incompleto; sobreposição temporal de ativos.
 * Supersede o set ativo anterior de mesma law/jurisdiction. Persiste evento append-only.
 * NÃO é executada nesta fase — é o checkpoint explícito do owner antes da LIVE.
 */
export async function approveAndActivateReferenceSet(input: ApproveActivateInput): Promise<{ setId: number; activated: true }> {
  const db = await getDb();
  if (!db) throw new LegalReferenceError("LEGAL_REFERENCE_SET_MISSING", "DB indisponível para aprovação.");
  const law = input.law ?? M.law;
  const jurisdiction = input.jurisdiction ?? M.jurisdiction;

  const found = await db.select().from(legalReferenceSets).where(and(
    eq(legalReferenceSets.law, law), eq(legalReferenceSets.jurisdiction, jurisdiction), eq(legalReferenceSets.version, input.version),
  )).limit(1);
  if (found.length === 0) throw new LegalReferenceError("LEGAL_REFERENCE_SET_MISSING", `Set v${input.version} inexistente.`);
  const set = found[0];

  if (set.contentHash !== input.expectedReferenceHash) {
    throw new LegalReferenceError("LEGAL_REFERENCE_CONTENT_HASH_INVALID", `expectedReferenceHash ≠ contentHash instalado (set v${input.version}).`);
  }
  const entries = await getReferenceEntries(set.id);
  if (entries.length === 0) throw new LegalReferenceError("LEGAL_REFERENCE_EMPTY", `Set v${input.version} incompleto (sem entries).`);
  // Integridade do source lineage (nenhuma entry sem authority/identifier/url).
  if (entries.some((e) => !e.sourceAuthority || !e.sourceIdentifier || !e.sourceUrl)) {
    throw new LegalReferenceError("LEGAL_REFERENCE_SOURCE_UNVERIFIED", `Set v${input.version}: source lineage incompleto.`);
  }

  await db.transaction(async (tx) => {
    // Supersede o(s) ativo(s) anterior(es) de mesma law/jurisdiction (mantém não-sobreposição).
    const actives = await tx.select().from(legalReferenceSets).where(and(
      eq(legalReferenceSets.law, law), eq(legalReferenceSets.jurisdiction, jurisdiction), eq(legalReferenceSets.status, "active"),
    ));
    for (const prev of actives) {
      if (prev.id === set.id) continue;
      await tx.update(legalReferenceSets).set({ status: "superseded" }).where(eq(legalReferenceSets.id, prev.id));
      await tx.insert(legalReferenceSetEvents).values({
        setId: prev.id, action: "superseded", fromStatus: "active", toStatus: "superseded",
        actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, correlationId: input.correlationId ?? null,
      });
    }
    await tx.update(legalReferenceSets).set({
      status: "active", approvedByUserId: input.actorUserId, approvedAt: new Date(),
      approvalSource: input.approvalSource, approvedReferenceHash: set.contentHash,
    }).where(eq(legalReferenceSets.id, set.id));
    await tx.insert(legalReferenceSetEvents).values({
      setId: set.id, action: "activated", fromStatus: set.status, toStatus: "active",
      actorUserId: input.actorUserId, actorRole: input.actorRole ?? null, correlationId: input.correlationId ?? null,
      approvedReferenceHash: set.contentHash,
    });
  });

  return { setId: set.id, activated: true };
}
