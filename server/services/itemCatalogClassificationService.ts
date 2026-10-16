/**
 * Classificação CATMAT/CATSER dos Itens Inteligentes sobre o catálogo OFICIAL.
 *
 * Estratégia POR CATÁLOGO (contratos reais da API, validados no Console do Railway staging):
 *   - CATMAT: busca textual oficial (`descricaoItem`) → filtro de RELEVÂNCIA local (`catalogSearchEngine`) sobre o que a
 *     fonte devolveu. Vazio é resposta legítima; linhas sem relação com o termo ⇒ "filtro possivelmente ignorado", nada
 *     sugerido. Smoke real (16/10/2026): `descricaoItem` só casa a descrição oficial COMPLETA e exata (palavra isolada ⇒
 *     0) — o caminho prático do CATMAT é "Verificar código".
 *   - CATSER: a API não tem filtro textual ⇒ busca no ÍNDICE sincronizado (cópia versionada do catálogo público, org 0)
 *     com o mesmo motor local; os melhores (≤ VERIFY_TOP_K) são VERIFICADOS um a um por código na fonte.
 *   - Os dois: "Verificar código" — o servidor informa o código; a fonte confirma existência, descrição e situação.
 * Toda sugestão persistida tem evidência oficial por órgão (`db/catalogEvidence`); nada é aplicado ao item; a
 * classificação só existe após a decisão humana no ledger (`catmatGovernanceService`). Nunca fabrica código.
 */
import { TRPCError } from "@trpc/server";
import { matchesFromRanked } from "../domain/catmatMatching";
import {
  catalogEvidenceChecksum, officialSourceLabel, verifySuggestionAgainstEvidence,
  type CatalogEvidence, type OfficialCatalogEntry, type OfficialCatalogType,
} from "../domain/officialCatalog";
import type { AvailableSuggestion } from "./catmatGovernanceService";
import {
  listOfficialCatalogPage, lookupOfficialCode, searchOfficialCatalog, MIN_PAGE_SIZE, UNAVAILABLE_MESSAGES,
  type CatalogUnavailableReason,
} from "./officialCatalogService";
import type { MatchSource } from "./catalogSearchEngine";
import { rankRelevant, type RelevantEntry } from "./catalogRelevance";
import { sanitizeFailureMessage } from "../domain/cognitiveProvenance";
import {
  getLatestCatalogIndex, getOfficialCatalogEvidence, loadCatalogIndexEntries, recordCatalogIndexSnapshot,
  recordOfficialCatalogEvidence, type CatalogIndexInfo,
} from "../db/catalogEvidence";
import { getIntelligentItem, insertCatmatMatch, listCatmatMatches, recordProcessEvent } from "../db/procurement";

/** Máximo de alternativas oficiais apresentadas por consulta. */
const MAX_CANDIDATES = 10;
/** CATSER: candidatos do índice verificados por código na fonte, por busca (controle de custo). */
export const VERIFY_TOP_K = 5;
/** CATMAT: linhas pedidas à busca textual oficial (≥ mínimo da API). */
const CATMAT_SEARCH_PAGE_SIZE = 50;

export const CATALOG_LABEL: Record<OfficialCatalogType, string> = { catmat: "CATMAT (material)", catser: "CATSER (serviço)" };

/** Natureza da correspondência apresentada ao servidor (explicabilidade). */
export type MatchMethod = "busca-textual-oficial" | "indice-sincronizado" | "codigo-informado";

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

// Relevância local (motor existente) — módulo puro, reexportado para os chamadores atuais.
export { rankRelevant, type RelevantEntry } from "./catalogRelevance";

// Índice em memória por snapshot (recarrega só quando há nova sincronização).
const indexCache = new Map<OfficialCatalogType, { snapshotId: string; entries: OfficialCatalogEntry[] }>();
export function __clearCatalogIndexCacheForTests(): void { indexCache.clear(); }

async function indexEntries(catalogType: OfficialCatalogType): Promise<{ info: CatalogIndexInfo; entries: OfficialCatalogEntry[] } | null> {
  const info = await getLatestCatalogIndex(catalogType);
  if (!info) return null;
  const hit = indexCache.get(catalogType);
  if (hit && hit.snapshotId === info.snapshotId) return { info, entries: hit.entries };
  const entries = await loadCatalogIndexEntries(catalogType, info.snapshotId);
  indexCache.set(catalogType, { snapshotId: info.snapshotId, entries });
  return { info, entries };
}

/** Pesquisa SOMENTE LEITURA no índice (sem persistir) — base da busca pública de serviços. */
export async function searchCatalogIndex(catalogType: OfficialCatalogType, term: string, topK = MAX_CANDIDATES): Promise<
  { status: "ok"; index: CatalogIndexInfo; results: RelevantEntry[] } | { status: "index_unavailable" }
> {
  const idx = await indexEntries(catalogType);
  if (!idx || idx.entries.length === 0) return { status: "index_unavailable" };
  return { status: "ok", index: idx.info, results: rankRelevant(term, idx.entries, topK) };
}

// ─── Busca de classificação do item ──────────────────────────────────────────

export interface ClassificationCandidate extends VerifiedSuggestion {
  readonly matchSource: MatchSource | "codigo";
  readonly matchedTokens: string[];
}

export type ItemClassificationSearch =
  | {
      readonly status: "ok"; readonly catalogType: OfficialCatalogType; readonly term: string; readonly method: MatchMethod;
      readonly retrievedAt: string; readonly snapshotId: string | null; readonly candidates: ClassificationCandidate[];
      readonly returned: number;
      /** A fonte devolveu linhas sem relação com o termo (filtro ignorado/interpretado) — nada sugerido. */
      readonly filterIgnoredSuspected: boolean;
      readonly index: { retrievedAt: string; complete: boolean; entries: number } | null;
      readonly discarded: { inactive: number; irrelevant: number; invalidRows: number; unverified: number };
    }
  | { readonly status: "unavailable"; readonly catalogType: OfficialCatalogType; readonly term: string; readonly reason: CatalogUnavailableReason; readonly message: string }
  | { readonly status: "index_unavailable"; readonly catalogType: OfficialCatalogType; readonly term: string; readonly message: string };

type ItemCtx = { organizationId: number; itemId: string; actorUserId: number; correlationId: string };

async function loadItem(p: ItemCtx) {
  const item = await getIntelligentItem(p.itemId, p.organizationId);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado." });
  const event = (summary: string) => recordProcessEvent({
    organizationId: p.organizationId, processId: item.processId, eventType: "catalog_lookup", actor: String(p.actorUserId),
    summary, refId: item.id, correlationId: p.correlationId,
  });
  return { item, event };
}

const unavailableMessage = (reason: CatalogUnavailableReason) =>
  `${UNAVAILABLE_MESSAGES[reason]} Nenhum código foi sugerido nem alterado; a classificação continua pendente. Tente novamente mais tarde.`;

/** Persiste candidatos já verificados (com evidência registrada) como sugestões do item. */
type RankedForPersist = Omit<RelevantEntry, "matchSource"> & { matchSource: MatchSource | "codigo" };

async function persistCandidates(p: ItemCtx, catalogType: OfficialCatalogType, ranked: readonly RankedForPersist[], at: string): Promise<ClassificationCandidate[]> {
  const matches = matchesFromRanked({
    itemId: p.itemId, organizationId: p.organizationId, correlationId: p.correlationId, createdAt: at,
    ranked: ranked.map((r) => ({ code: r.entry.code, description: r.entry.description, score: r.score, source: officialSourceLabel(catalogType) })),
  });
  for (const m of matches) await insertCatmatMatch(m);
  const verifiedById = new Map((await listVerifiedSuggestions(p.itemId, p.organizationId)).map((s) => [s.id, s]));
  return matches.flatMap((m, i): ClassificationCandidate[] => {
    const s = verifiedById.get(m.id);
    return s ? [{ ...s, matchSource: ranked[i].matchSource, matchedTokens: ranked[i].matchedTokens }] : [];
  });
}

/**
 * "Buscar classificação": consulta conforme o contrato do catálogo indicado pelo servidor e persiste só alternativas
 * REAIS e RELEVANTES, com evidência oficial por órgão. Não decide nada.
 */
export async function searchItemClassification(p: ItemCtx & { catalogType: OfficialCatalogType; term?: string | null }): Promise<ItemClassificationSearch> {
  const { item, event } = await loadItem(p);
  const term = (p.term ?? "").replace(/\s+/g, " ").trim() || item.description.replace(/\s+/g, " ").trim();
  if (term.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um termo de busca com pelo menos 2 caracteres." });
  const label = CATALOG_LABEL[p.catalogType];

  if (p.catalogType === "catmat") {
    const res = await searchOfficialCatalog({ catalogType: "catmat", term, pageSize: CATMAT_SEARCH_PAGE_SIZE });
    if (res.status === "unavailable") {
      await event(`Consulta ${label} indisponível (${res.reason}) — nada gravado; classificação pendente.`);
      return { status: "unavailable", catalogType: "catmat", term, reason: res.reason, message: unavailableMessage(res.reason) };
    }
    const active = res.entries.filter((e) => e.active === true);
    const relevant = rankRelevant(term, active, MAX_CANDIDATES);
    const filterIgnoredSuspected = res.entries.length > 0 && rankRelevant(term, res.entries, 1).length === 0;
    const evidence = res.entries.length > 0 ? await recordOfficialCatalogEvidence({
      organizationId: p.organizationId, catalogType: "catmat", entries: res.entries, checksum: res.checksum,
      retrievedAt: res.retrievedAt, sourceUrl: res.sourceUrl, query: res.query, correlationId: p.correlationId,
    }) : null;
    const candidates = relevant.length > 0 ? await persistCandidates(p, "catmat", relevant, res.retrievedAt) : [];
    await event(
      `Consulta ${label} ("${term.slice(0, 80)}"): ${res.entries.length} retornado(s), ${candidates.length} alternativa(s) relevante(s)` +
      `${filterIgnoredSuspected ? " — linhas sem relação com o termo (filtro possivelmente ignorado), nada sugerido" : ""}` +
      `${evidence ? ` · evidência ${evidence.snapshotId}` : ""}.`,
    );
    return {
      status: "ok", catalogType: "catmat", term, method: "busca-textual-oficial", retrievedAt: res.retrievedAt,
      snapshotId: evidence?.snapshotId ?? null, candidates, returned: res.entries.length, filterIgnoredSuspected, index: null,
      discarded: { inactive: res.entries.length - active.length, irrelevant: active.length - relevant.length, invalidRows: res.discardedRows, unverified: 0 },
    };
  }

  // CATSER — índice sincronizado + verificação por código na fonte (a API não tem filtro textual).
  const idx = await searchCatalogIndex("catser", term, VERIFY_TOP_K);
  if (idx.status === "index_unavailable") {
    await event(`Busca ${label} sem índice sincronizado — nada sugerido; use "Verificar código".`);
    return {
      status: "index_unavailable", catalogType: "catser", term,
      message: "A API oficial do CATSER não oferece busca por descrição e o índice de serviços ainda não foi sincronizado neste ambiente. "
        + "Informe o código CATSER em \"Verificar código\" (consulta oficial por código) ou declare \"sem correspondência segura\".",
    };
  }
  const verified: RelevantEntry[] = [];
  let unverified = 0;
  let lastUnavailable: CatalogUnavailableReason | null = null;
  let snapshotId: string | null = null;
  let retrievedAt = new Date().toISOString();
  for (const r of idx.results) {
    const look = await lookupOfficialCode({ catalogType: "catser", code: r.entry.code });
    if (look.status === "unavailable") { lastUnavailable = look.reason; unverified++; continue; }
    if (look.status === "not_found" || look.entry.active !== true) { unverified++; continue; }
    // Relevância recalculada sobre a descrição OFICIAL atual (o índice pode estar defasado).
    const [rel] = rankRelevant(term, [look.entry], 1);
    if (!rel) { unverified++; continue; }
    const ev = await recordOfficialCatalogEvidence({
      organizationId: p.organizationId, catalogType: "catser", entries: [look.entry], checksum: look.result.checksum,
      retrievedAt: look.result.retrievedAt, sourceUrl: look.result.sourceUrl, query: look.result.query, correlationId: p.correlationId,
    });
    snapshotId = ev?.snapshotId ?? snapshotId;
    retrievedAt = look.result.retrievedAt;
    verified.push({ ...rel, matchSource: r.matchSource, matchedTokens: r.matchedTokens });
  }
  if (idx.results.length > 0 && verified.length === 0 && lastUnavailable) {
    await event(`Verificação ${label} por código indisponível (${lastUnavailable}) — nada gravado; classificação pendente.`);
    return { status: "unavailable", catalogType: "catser", term, reason: lastUnavailable, message: unavailableMessage(lastUnavailable) };
  }
  const candidates = verified.length > 0 ? await persistCandidates(p, "catser", verified, retrievedAt) : [];
  await event(
    `Busca ${label} ("${term.slice(0, 80)}") no índice de ${idx.index.retrievedAt.slice(0, 10)}: ${idx.results.length} candidato(s), ` +
    `${candidates.length} verificado(s) por código na fonte${unverified ? `, ${unverified} não verificado(s)` : ""}.`,
  );
  return {
    status: "ok", catalogType: "catser", term, method: "indice-sincronizado", retrievedAt, snapshotId, candidates,
    returned: idx.results.length, filterIgnoredSuspected: false,
    index: { retrievedAt: idx.index.retrievedAt, complete: idx.index.complete, entries: idx.index.entries },
    discarded: { inactive: 0, irrelevant: 0, invalidRows: 0, unverified },
  };
}

// ─── Verificar código informado pelo servidor ────────────────────────────────

export type CodeVerification =
  | { readonly status: "verified"; readonly catalogType: OfficialCatalogType; readonly candidate: ClassificationCandidate }
  | { readonly status: "not_found" | "inactive"; readonly catalogType: OfficialCatalogType; readonly code: string; readonly message: string; readonly officialDescription?: string }
  | { readonly status: "unavailable"; readonly catalogType: OfficialCatalogType; readonly code: string; readonly reason: CatalogUnavailableReason; readonly message: string };

/** Consulta oficial POR CÓDIGO (parâmetro do catálogo) e, se ativo, registra como alternativa verificada do item. */
export async function verifyItemCode(p: ItemCtx & { catalogType: OfficialCatalogType; code: string }): Promise<CodeVerification> {
  const { item, event } = await loadItem(p);
  const code = p.code.trim();
  const label = CATALOG_LABEL[p.catalogType];
  const look = await lookupOfficialCode({ catalogType: p.catalogType, code });
  if (look.status === "unavailable") {
    await event(`Verificação ${label} do código ${code.slice(0, 12)} indisponível (${look.reason}) — nada gravado.`);
    return { status: "unavailable", catalogType: p.catalogType, code, reason: look.reason, message: unavailableMessage(look.reason) };
  }
  if (look.status === "not_found") {
    await event(`Código ${code.slice(0, 12)} não encontrado no ${label} — nada gravado.`);
    return { status: "not_found", catalogType: p.catalogType, code, message: `O código ${code} não foi encontrado no ${label}. Confira o código e o catálogo (material × serviço).` };
  }
  await recordOfficialCatalogEvidence({
    organizationId: p.organizationId, catalogType: p.catalogType, entries: [look.entry], checksum: look.result.checksum,
    retrievedAt: look.result.retrievedAt, sourceUrl: look.result.sourceUrl, query: look.result.query, correlationId: p.correlationId,
  });
  if (look.entry.active !== true) {
    await event(`Código ${code} do ${label} consultado: ${look.entry.active === false ? "inativo" : "situação não informada"} — não sugerido.`);
    return {
      status: "inactive", catalogType: p.catalogType, code, officialDescription: look.entry.description,
      message: `O código ${code} existe no ${label} ("${look.entry.description.slice(0, 120)}"), mas ${look.entry.active === false ? "está inativo" : "a fonte não informou a situação"} — não pode ser confirmado.`,
    };
  }
  const [rel] = rankRelevant(item.description, [look.entry], 1);
  const ranked = { entry: look.entry, score: rel?.score ?? 0, matchSource: "codigo" as const, matchedTokens: rel?.matchedTokens ?? [] };
  const [candidate] = await persistCandidates(p, p.catalogType, [ranked], look.result.retrievedAt);
  await event(`Código ${code} verificado no ${label} ("${look.entry.description.slice(0, 80)}") — alternativa registrada, sem decisão.`);
  if (!candidate) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Falha ao registrar a alternativa verificada." });
  return { status: "verified", catalogType: p.catalogType, candidate };
}

// ─── Sincronização do índice (operação explícita, limitada) ──────────────────

export interface CatalogIndexSyncResult {
  readonly status: "synced" | "failed";
  readonly catalogType: OfficialCatalogType;
  readonly pages: number; readonly entries: number; readonly total: number | null; readonly complete: boolean;
  readonly snapshotId: string | null; readonly replayed: boolean; readonly reason?: string;
  /** Resultado da publicação serializada: novo snapshot, replay sem escrita ou reconduzido a vigente. */
  readonly publication?: "published" | "replayed" | "republished";
}

/**
 * Sincroniza o índice de pesquisa de um catálogo (operação de plataforma, nunca por busca de usuário). Limites:
 * `maxPages` × `pageSize` linhas; uma leitura por página, sem cache. Falha na leitura OU na gravação ⇒ NADA publicado
 * (transação única; índice anterior preservado). Atingir `maxPages` ⇒ snapshot PARCIAL (marcado), publicado só se não houver
 * índice completo (parcial nunca substitui completo). Sincronização
 * concorrente do mesmo catálogo ⇒ recusada. Mesmo conteúdo já publicado ⇒ replay sem escrita.
 *
 * Integridade (fail-closed — nada publicado, índice anterior preservado):
 *   - registro descartado pelo leitor em qualquer página (código/descrição inválidos) ⇒ falha;
 *   - `totalRegistros` ausente ou alterado entre páginas ⇒ completude não comprovável ⇒ falha;
 *   - código repetido entre páginas (paginação instável) ⇒ falha;
 *   - "completo" só quando os códigos ÚNICOS coletados == `totalRegistros` oficial; divergência ⇒ falha;
 *   - banco indisponível (publicação não confirmada) ⇒ falha, nunca sucesso sem `snapshotId`.
 */
export async function syncCatalogIndex(p: {
  catalogType: OfficialCatalogType; pageSize: number; maxPages: number; correlationId: string;
  onPage?: (page: number, rows: number) => void;
  /** Espera máxima pelo lock de publicação do catálogo (outra sincronização em curso). */
  lockWaitSeconds?: number;
}): Promise<CatalogIndexSyncResult> {
  const pageSize = Math.max(MIN_PAGE_SIZE, Math.floor(p.pageSize));
  const maxPages = Math.max(1, Math.min(2000, Math.floor(p.maxPages)));
  const all = new Map<string, OfficialCatalogEntry>();
  let total: number | null = null;
  let complete = false;
  let pages = 0;
  let sourceUrl = "";
  let rowsRead = 0;
  const fail = (reason: string): CatalogIndexSyncResult => ({
    status: "failed", catalogType: p.catalogType, pages, entries: all.size, total, complete: false, snapshotId: null, replayed: false, reason,
  });
  for (let page = 1; page <= maxPages; page++) {
    const res = await listOfficialCatalogPage({ catalogType: p.catalogType, page, pageSize, activeOnly: true });
    if (res.status === "unavailable") return fail(`${res.reason}: ${res.detail} (página ${page})`);
    if (res.discardedRows > 0) {
      return fail(`integridade: ${res.discardedRows} registro(s) da página ${page} descartado(s) pelo leitor (código ou descrição inválidos) — catálogo não comprovável; nada publicado.`);
    }
    if (res.total === null) {
      return fail(`integridade: a fonte não informou totalRegistros (página ${page}) — completude não comprovável; nada publicado.`);
    }
    if (total !== null && res.total !== total) {
      return fail(`integridade: totalRegistros mudou durante a paginação (${total} → ${res.total}, página ${page}) — catálogo alterado na fonte; nada publicado, repita a sincronização.`);
    }
    pages = page;
    total = res.total;
    sourceUrl = sourceUrl || res.sourceUrl;
    rowsRead += res.entries.length;
    for (const e of res.entries) all.set(e.code, e);
    p.onPage?.(page, res.entries.length);
    if (res.entries.length < pageSize || res.remainingPages === 0) { complete = true; break; }
  }
  if (all.size !== rowsRead) {
    return fail(`integridade: ${rowsRead - all.size} código(s) repetido(s) entre páginas (${rowsRead} linha(s), ${all.size} código(s) único(s)) — paginação instável; nada publicado.`);
  }
  if (complete && all.size !== total) {
    return fail(`integridade: ${all.size} código(s) único(s) coletado(s) × totalRegistros oficial ${total} — sincronização completa não comprovada; nada publicado.`);
  }
  // Parcial (limite de páginas) nunca substitui um índice COMPLETO já publicado — a cobertura não pode regredir.
  // Checagem antecipada (evita trabalho); a AUTORITATIVA é refeita dentro da publicação serializada.
  if (!complete && (await getLatestCatalogIndex(p.catalogType))?.complete) {
    return {
      status: "failed", catalogType: p.catalogType, pages, entries: all.size, total, complete: false, snapshotId: null, replayed: false,
      reason: `limite de ${maxPages} página(s) atingido antes do fim do catálogo — índice completo anterior preservado; aumente --max-pages.`,
    };
  }
  const entries = [...all.values()];
  const retrievedAt = new Date().toISOString();
  const checksum = catalogEvidenceChecksum({ catalogType: p.catalogType, query: { page: 1, pageSize }, entries });
  let rec: Awaited<ReturnType<typeof recordCatalogIndexSnapshot>>;
  try {
    rec = await recordCatalogIndexSnapshot({
      catalogType: p.catalogType, entries, checksum, retrievedAt, sourceUrl, pages, total, complete, pageSize, correlationId: p.correlationId,
      lockWaitSeconds: p.lockWaitSeconds,
    });
  } catch (err) {
    // Rollback: nenhum snapshot novo publicado; o índice anterior continua valendo.
    return { status: "failed", catalogType: p.catalogType, pages, entries: entries.length, total, complete, snapshotId: null, replayed: false, reason: `persistência: ${sanitizeFailureMessage(String((err as Error)?.message ?? err)).slice(0, 200)}` };
  }
  if (!rec) {
    // Sem banco não há publicação: nunca devolver sucesso sem snapshot persistido.
    return { status: "failed", catalogType: p.catalogType, pages, entries: entries.length, total, complete, snapshotId: null, replayed: false, reason: "persistência: banco de dados indisponível — nenhum snapshot publicado." };
  }
  indexCache.delete(p.catalogType);
  if (rec.status === "refused_partial") {
    // Revalidado DENTRO da serialização: um índice completo foi publicado enquanto esta leitura acontecia.
    return {
      status: "failed", catalogType: p.catalogType, pages, entries: entries.length, total, complete, snapshotId: null, replayed: false,
      reason: `parcial recusado: índice completo vigente ${rec.currentSnapshotId} preservado.`,
    };
  }
  return {
    status: "synced", catalogType: p.catalogType, pages, entries: entries.length, total, complete, snapshotId: rec.snapshotId,
    replayed: rec.status === "replayed", publication: rec.status,
  };
}
