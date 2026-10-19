/* eslint-disable no-console -- CLI de diagnóstico: o relatório é a saída no terminal */
/**
 * Sonda SOMENTE LEITURA do ranking de candidatos CATSER sobre as descrições OFICIAIS reais (API pública).
 * Compara o ranking de REFERÊNCIA (o `catalogRelevance.ts` de `origin/staging`, copiado pelo workflow para
 * `server/services/catalogRelevance.baseline.ts` — nunca versionado) com o atual (`rankRelevant`) para consultas fixas,
 * e confere por código, na fonte, os candidatos do ranking atual. Sem banco, sem segredos, nada gravado.
 *
 * Uso (ambiente com saída HTTPS para dadosabertos.compras.gov.br — ex.: workflow `catalog-official-smoke.yml`):
 *   pnpm catalog:ranking-probe
 */
import { listOfficialCatalogPage, lookupOfficialCode } from "../server/services/officialCatalogService";
import { rankRelevant, objectTerms, type RelevantEntry } from "../server/services/catalogRelevance";
import type { OfficialCatalogEntry } from "../server/domain/officialCatalog";

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const TOP_K = 5;
const QUERIES = [
  "Serviços de tradução juramentada",
  "Serviços de tradução e interpretação simultânea",
  "Locação de equipamentos para tradução simultânea e sonorização",
  "Serviços de tradução, adaptação e versão de textos",
  "Prestação de serviços de limpeza e conservação de ambientes administrativos.",
  "Prestação de serviços de transporte de passageiros",
  "Serviços de vigilância patrimonial",
  "limpeza",
  "tradução",
  "transporte",
];

type Ranked = Pick<RelevantEntry, "entry" | "score" | "matchSource" | "matchedTokens"> & Partial<Pick<RelevantEntry, "missingTokens" | "activityMatch">>;
type RankFn = (term: string, entries: readonly OfficialCatalogEntry[], topK: number) => Ranked[];

/** Ranking de referência (staging) — ausente fora do workflow ⇒ a sonda mostra só o atual. */
async function baselineRanking(): Promise<RankFn | null> {
  const path = "../server/services/catalogRelevance.baseline";
  try { return ((await import(path)) as { rankRelevant: RankFn }).rankRelevant; } catch { return null; }
}

const line = (r: Ranked, extra = "") =>
  `    ${r.entry.code.padStart(6)} · ${r.score.toFixed(3)} · ${r.matchSource.padEnd(10)} · [${r.matchedTokens.join(", ")}]` +
  `${r.activityMatch === false ? " · ATIVIDADE PRINCIPAL DIFERENTE" : ""}${r.missingTokens?.length ? ` · não consta: [${r.missingTokens.join(", ")}]` : ""}` +
  `${extra} · ${r.entry.description.slice(0, 90)}`;

async function main(): Promise<number> {
  const all = new Map<string, OfficialCatalogEntry>();
  let total: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await listOfficialCatalogPage({ catalogType: "catser", page, pageSize: PAGE_SIZE, activeOnly: true });
    if (res.status === "unavailable") { console.log(`[RANKING-PROBE] fonte indisponível (${res.reason}: ${res.detail}) na página ${page}`); return 1; }
    total = res.total ?? total;
    for (const e of res.entries) all.set(e.code, e);
    if (res.entries.length < PAGE_SIZE || res.remainingPages === 0) break;
  }
  const entries = [...all.values()].filter((e) => e.active === true);
  const previousRanking = await baselineRanking();
  const ref = process.env.CATALOG_PROBE_BASELINE_REF ?? "referência";
  console.log(`[RANKING-PROBE] CATSER oficial: ${entries.length} serviço(s) ativo(s) lido(s) · totalRegistros ${total}${total !== null && all.size !== total ? " · ATENÇÃO: leitura incompleta" : ""}`);

  for (const term of QUERIES) {
    const before = previousRanking ? previousRanking(term, entries, TOP_K) : [];
    const after = rankRelevant(term, entries, TOP_K);
    console.log(`\n=== "${term}"  ·  termos do objeto: [${objectTerms(term).join(", ")}]`);
    console.log(previousRanking ? `  ANTES — ${ref} (${before.length}):` : "  ANTES: sem ranking de referência (fora do workflow)");
    for (const r of before) console.log(line(r));
    console.log(`  DEPOIS (${after.length}):`);
    for (const r of after) {
      const look = await lookupOfficialCode({ catalogType: "catser", code: r.entry.code });
      const status = look.status === "found" ? (look.entry.active === true ? " · verificado: ativo" : " · verificado: INATIVO") : ` · verificação: ${look.status}`;
      console.log(line(r, status));
    }
    const b = new Set(before.map((r) => r.entry.code));
    const a = new Set(after.map((r) => r.entry.code));
    console.log(`  saíram: [${[...b].filter((c) => !a.has(c)).join(", ")}] · entraram: [${[...a].filter((c) => !b.has(c)).join(", ")}]`);
  }
  return 0;
}

main().then((code) => process.exit(code), (err: unknown) => { console.error(`[RANKING-PROBE] ERRO: ${String((err as Error)?.message ?? err).slice(0, 300)}`); process.exit(1); });
