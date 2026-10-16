/* eslint-disable no-console -- CLI de diagnóstico: o relatório é a saída no terminal */
/**
 * Smoke REAL (somente leitura) do catálogo oficial CATMAT/CATSER — separado do CI. SONDA o comportamento real da API
 * em vez de presumi-lo (paginação, filtro textual, consulta por código, payload).
 *
 * Uso (console com saída HTTPS para dadosabertos.compras.gov.br, ex.: Console do Railway staging):
 *   pnpm catalog:smoke                 # termo de exemplo "notebook"
 *   pnpm catalog:smoke -- "cadeira"    # outro termo para a sonda textual do CATMAT
 *
 * Não usa banco, não grava nada, não precisa de credencial. Saída 0 ⇒ consulta por código confirmada nos dois catálogos
 * (base da verificação oficial); as sondas textuais são DIAGNÓSTICO (classificam o filtro, não reprovam).
 */
import { fetchOfficialCatalogRaw, buildCatalogParams, OFFICIAL_CATALOG_CONTRACTS } from "../server/services/officialCatalogService";
import { parseOfficialCatalogPayload, normalizeCatalogDescription, type OfficialCatalogEntry, type OfficialCatalogType } from "../server/domain/officialCatalog";
import { rankRelevant } from "../server/services/itemCatalogClassificationService";
import { CATALOG_CONFIG } from "../server/config/catalog";

const NONSENSE = "ZZQXKWVJ";

type Probe = { ok: boolean; status: string; entries: OfficialCatalogEntry[]; total: number | null; keys: string[] };

async function probe(type: OfficialCatalogType, params: Record<string, string>): Promise<Probe> {
  const raw = await fetchOfficialCatalogRaw(type, params);
  if (!raw.ok) return { ok: false, status: `${raw.reason} (${raw.detail})`, entries: [], total: null, keys: [] };
  const keys = raw.json && typeof raw.json === "object" && !Array.isArray(raw.json) ? Object.keys(raw.json as object) : ["(lista na raiz)"];
  const parsed = parseOfficialCatalogPayload(raw.json, type);
  if (!parsed.ok) return { ok: false, status: "malformed", entries: [], total: null, keys };
  return { ok: true, status: "ok", entries: parsed.entries, total: parsed.total, keys };
}

const show = (label: string, p: Probe, term?: string) => {
  const rel = term ? rankRelevant(term, p.entries, 50).length : null;
  console.log(`  ${label.padEnd(44)} ${p.ok ? `${p.entries.length} linha(s)${p.total !== null ? ` / total ${p.total}` : ""}${rel !== null ? ` · relevantes ${rel}` : ""}` : `FALHA ${p.status}`}`);
  return rel;
};

async function checkCode(type: OfficialCatalogType, sample: OfficialCatalogEntry | undefined): Promise<boolean> {
  if (!sample) { console.log("  consulta por código: sem amostra"); return false; }
  const p = await probe(type, buildCatalogParams(type, { code: sample.code }));
  const hit = p.entries.find((e) => e.code === sample.code);
  const others = p.entries.filter((e) => e.code !== sample.code).length;
  console.log(`  consulta por ${OFFICIAL_CATALOG_CONTRACTS[type].codeParam}=${sample.code}: ${hit ? "ENCONTRADO" : "NÃO encontrado"}` +
    `${hit ? ` · descrição idêntica: ${normalizeCatalogDescription(hit.description) === normalizeCatalogDescription(sample.description)} · ativo: ${hit.active}` : ""}` +
    `${others ? ` · ${others} outra(s) linha(s) (filtro por código ignorado?)` : ""}`);
  return !!hit && others === 0;
}

async function catmat(term: string): Promise<boolean> {
  console.log(`\n=== CATMAT (${CATALOG_CONFIG.baseUrl}${OFFICIAL_CATALOG_CONTRACTS.catmat.endpoint})`);
  const list = await probe("catmat", buildCatalogParams("catmat", { page: 1, pageSize: 10, activeOnly: true }));
  console.log(`  envelope: ${list.keys.join(", ")}`);
  show("lista sem filtro (pagina=1, tamanhoPagina=10)", list);
  const sample = list.entries[0];
  if (sample) console.log(`  amostra: ${sample.code} | ${sample.description.slice(0, 90)}`);
  const codeOk = await checkCode("catmat", sample);
  if (sample) {
    const first = normalizeCatalogDescription(sample.description).split(" ").find((w) => w.length >= 4) ?? sample.description.split(" ")[0];
    const exact = await probe("catmat", buildCatalogParams("catmat", { term: sample.description, pageSize: 10, activeOnly: true }));
    show("descricaoItem = descrição COMPLETA da amostra", exact);
    console.log(`    contém a amostra: ${exact.entries.some((e) => e.code === sample.code)}`);
    show(`descricaoItem = "${first}" (1ª palavra, MAIÚSC.)`, await probe("catmat", buildCatalogParams("catmat", { term: first, pageSize: 10, activeOnly: true })), first);
    show(`descricaoItem = "${first.toLowerCase()}" (minúsc.)`, await probe("catmat", buildCatalogParams("catmat", { term: first.toLowerCase(), pageSize: 10, activeOnly: true })), first);
  }
  show(`descricaoItem = "${term}"`, await probe("catmat", buildCatalogParams("catmat", { term, pageSize: 10, activeOnly: true })), term);
  show(`descricaoItem = "${term.toUpperCase()}"`, await probe("catmat", buildCatalogParams("catmat", { term: term.toUpperCase(), pageSize: 10, activeOnly: true })), term);
  const nonsense = await probe("catmat", buildCatalogParams("catmat", { term: NONSENSE, pageSize: 10, activeOnly: true }));
  show(`descricaoItem = "${NONSENSE}" (inexistente)`, nonsense);
  console.log(`  ⇒ filtro textual: ${!nonsense.ok ? "INCONCLUSIVO (sonda falhou)" : nonsense.entries.length > 0 ? "IGNORADO pela fonte (inexistente devolve linhas)" : "aplicado (inexistente devolve vazio) — ver linhas acima para exato × parcial × maiúsculas"}`);
  const small = await fetchOfficialCatalogRaw("catmat", { pagina: "1", tamanhoPagina: "9", statusItem: "true" });
  console.log(`  tamanhoPagina=9: ${small.ok ? "aceito" : small.reason === "http_error" ? `recusado pela fonte (${small.detail})` : `INCONCLUSIVO (${small.reason})`}`);
  return codeOk;
}

async function catser(): Promise<boolean> {
  console.log(`\n=== CATSER (${CATALOG_CONFIG.baseUrl}${OFFICIAL_CATALOG_CONTRACTS.catser.endpoint})`);
  const list = await probe("catser", buildCatalogParams("catser", { page: 1, pageSize: 10, activeOnly: true }));
  console.log(`  envelope: ${list.keys.join(", ")}`);
  show("lista sem filtro (pagina=1, tamanhoPagina=10)", list);
  const sample = list.entries[0];
  if (sample) console.log(`  amostra: ${sample.code} | ${sample.description.slice(0, 90)} | ativo ${sample.active}`);
  const codeOk = await checkCode("catser", sample);
  // Parâmetro textual NÃO documentado: enviado só aqui, para confirmar que é ignorado (o sistema nunca o envia).
  const ignored = await probe("catser", { pagina: "1", tamanhoPagina: "10", statusServico: "true", descricaoItem: NONSENSE });
  console.log(`  descricaoItem="${NONSENSE}" (não documentado): ${!ignored.ok ? `INCONCLUSIVO (${ignored.status})` : ignored.entries.length > 0 ? "IGNORADO (devolve linhas) — confirmado: não usar" : "devolveu vazio"}`);
  for (const size of [100, 500]) {
    const p = await probe("catser", buildCatalogParams("catser", { page: 1, pageSize: size, activeOnly: true }));
    console.log(`  tamanhoPagina=${size}: ${p.ok ? `${p.entries.length} linha(s)` : `FALHA ${p.status}`}`);
  }
  if (list.total !== null) console.log(`  ⇒ sincronização do índice: ~${Math.ceil(list.total / 100)} página(s) de 100 (pnpm catalog:sync -- catser)`);
  return codeOk && list.ok;
}

async function main(): Promise<void> {
  const term = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "notebook";
  const okMat = await catmat(term);
  const okSer = await catser();
  console.log(`\n[CATALOGO-OFICIAL-SMOKE] código CATMAT=${okMat ? "OK" : "FALHA"} código CATSER=${okSer ? "OK" : "FALHA"}`);
  process.exit(okMat && okSer ? 0 : 1);
}

void main();
