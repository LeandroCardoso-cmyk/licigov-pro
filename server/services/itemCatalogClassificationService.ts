/**
 * Classificação CATMAT/CATSER dos Itens Inteligentes sobre o catálogo OFICIAL.
 *
 * Fluxo: item → "Buscar classificação" (o servidor indica material = CATMAT ou serviço = CATSER) → consulta oficial
 * (`officialCatalogService`) → evidência por órgão (`db/catalogEvidence`) → ranking textual SÓ sobre códigos retornados
 * pela fonte → sugestões persistidas (`item_catmat_matches`) → decisão humana no ledger (`catmatGovernanceService`).
 *
 * Nunca fabrica código: indisponibilidade ⇒ "indisponível", nada gravado, classificação pendente. Nada é aplicado ao
 * item automaticamente (nem o código "sugerido"): a classificação só existe após a decisão humana registrada.
 */
import { TRPCError } from "@trpc/server";
import { rankCATMAT } from "../domain/catmatMatching";
import {
  officialSourceLabel, verifySuggestionAgainstEvidence,
  type CatalogEvidence, type OfficialCatalogType,
} from "../domain/officialCatalog";
import type { AvailableSuggestion } from "./catmatGovernanceService";
import { searchOfficialCatalog, UNAVAILABLE_MESSAGES, type CatalogUnavailableReason } from "./officialCatalogService";
import { getOfficialCatalogEvidence, recordOfficialCatalogEvidence } from "../db/catalogEvidence";
import { getIntelligentItem, insertCatmatMatch, listCatmatMatches, recordProcessEvent } from "../db/procurement";

/** Máximo de alternativas oficiais apresentadas por consulta. */
const MAX_CANDIDATES = 10;

export const CATALOG_LABEL: Record<OfficialCatalogType, string> = { catmat: "CATMAT (material)", catser: "CATSER (serviço)" };

export interface VerifiedSuggestion extends AvailableSuggestion {
  readonly rank: number;
  readonly decision: string;
  readonly verified: boolean;
  readonly catalogType: OfficialCatalogType | null;
  readonly retrievedAt: string | null;
  readonly evidenceSnapshotId: string | null;
  readonly verificationNote: string | null;
}

/** Sugestões persistidas do item, cada uma com o estado de verificação contra a evidência oficial do órgão. */
export async function listVerifiedSuggestions(itemId: string, organizationId: number): Promise<VerifiedSuggestion[]> {
  const persisted = await listCatmatMatches(itemId, organizationId);
  if (persisted.length === 0) return [];
  const evidence: CatalogEvidence[] = await getOfficialCatalogEvidence(organizationId, persisted.map((m) => m.catmatCode));
  return persisted.map((m) => {
    const v = verifySuggestionAgainstEvidence(m, evidence);
    return {
      id: m.id, catmatCode: m.catmatCode, catmatDescription: m.catmatDescription, score: m.score, rank: m.rank, decision: m.decision,
      source: v.source, verified: v.verified, catalogType: v.catalogType, retrievedAt: v.evidence?.retrievedAt ?? null,
      evidenceSnapshotId: v.evidence?.snapshotId ?? null, verificationNote: v.reason,
    };
  });
}

export type ItemClassificationSearch =
  | {
      readonly status: "ok"; readonly catalogType: OfficialCatalogType; readonly term: string; readonly retrievedAt: string;
      readonly snapshotId: string | null; readonly candidates: VerifiedSuggestion[]; readonly returned: number;
      readonly discarded: { inactive: number; noTextualMatch: number; invalidRows: number };
    }
  | { readonly status: "unavailable"; readonly catalogType: OfficialCatalogType; readonly term: string; readonly reason: CatalogUnavailableReason; readonly message: string };

/**
 * "Buscar classificação": consulta o catálogo oficial com a descrição do item (ou termo ajustado pelo servidor),
 * registra a evidência e persiste as alternativas reais. Nada é decidido aqui.
 */
export async function searchItemClassification(p: {
  organizationId: number; itemId: string; catalogType: OfficialCatalogType; term?: string | null;
  actorUserId: number; correlationId: string;
}): Promise<ItemClassificationSearch> {
  const item = await getIntelligentItem(p.itemId, p.organizationId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
  const term = (p.term ?? "").replace(/\s+/g, " ").trim() || item.description.replace(/\s+/g, " ").trim();
  if (term.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um termo de busca com pelo menos 2 caracteres." });

  const res = await searchOfficialCatalog({ catalogType: p.catalogType, term });
  const event = (summary: string) => recordProcessEvent({
    organizationId: p.organizationId, processId: item.processId, eventType: "catalog_lookup", actor: String(p.actorUserId),
    summary, refId: item.id, correlationId: p.correlationId,
  });
  if (res.status === "unavailable") {
    await event(`Consulta ${CATALOG_LABEL[p.catalogType]} indisponível (${res.reason}) — nada gravado; classificação pendente.`);
    return {
      status: "unavailable", catalogType: p.catalogType, term, reason: res.reason,
      message: `${UNAVAILABLE_MESSAGES[res.reason]} Nenhum código foi sugerido nem alterado; a classificação continua pendente. Tente novamente mais tarde.`,
    };
  }

  const active = res.entries.filter((e) => e.active === true);
  const evidence = await recordOfficialCatalogEvidence({
    organizationId: p.organizationId, catalogType: p.catalogType, entries: res.entries, checksum: res.checksum,
    retrievedAt: res.retrievedAt, sourceUrl: res.sourceUrl, query: res.query, correlationId: p.correlationId,
  });
  // Ranking textual SÓ entre códigos retornados pela fonte (nunca candidatos gerados localmente).
  const ranked = rankCATMAT({
    itemId: item.id, organizationId: p.organizationId, description: term,
    candidates: active.map((e) => ({ code: e.code, description: e.description, source: officialSourceLabel(p.catalogType) })),
    correlationId: p.correlationId, createdAt: res.retrievedAt,
  });
  const kept = ranked.filter((m) => m.score > 0).slice(0, MAX_CANDIDATES);
  for (const m of kept) await insertCatmatMatch(m);
  await event(
    `Consulta ${CATALOG_LABEL[p.catalogType]} ("${term.slice(0, 80)}"): ${res.entries.length} retornado(s), ${kept.length} alternativa(s) oficial(is)` +
    `${evidence ? ` · evidência ${evidence.snapshotId}` : ""}.`,
  );
  const verifiedById = new Map((await listVerifiedSuggestions(item.id, p.organizationId)).map((s) => [s.id, s]));
  return {
    status: "ok", catalogType: p.catalogType, term, retrievedAt: res.retrievedAt, snapshotId: evidence?.snapshotId ?? null,
    candidates: kept.map((m) => verifiedById.get(m.id)).filter((s): s is VerifiedSuggestion => !!s),
    returned: res.entries.length,
    discarded: { inactive: res.entries.length - active.length, noTextualMatch: ranked.length - ranked.filter((m) => m.score > 0).length, invalidRows: res.discardedRows },
  };
}
