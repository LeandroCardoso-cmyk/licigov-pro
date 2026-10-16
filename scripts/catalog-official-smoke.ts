/* eslint-disable no-console -- CLI de diagnóstico: o relatório é a saída no terminal */
/**
 * Smoke REAL (somente leitura) do catálogo oficial CATMAT/CATSER — separado do CI.
 *
 * Uso (máquina/console com saída HTTPS para dadosabertos.compras.gov.br, ex.: Console do Railway staging):
 *   pnpm catalog:smoke                       # termos padrão
 *   pnpm catalog:smoke -- notebook limpeza   # termo CATMAT e termo CATSER
 *
 * Não usa banco, não grava nada, não precisa de credencial. Mostra, para cada catálogo: situação da consulta, chaves do
 * envelope, quantas linhas o parser reconheceu, se o filtro por descrição parece efetivo e a conferência por código.
 * Saída 0 = contrato confirmado nos dois catálogos; 1 = indisponível/divergente (detalhe no relatório).
 */
import {
  fetchOfficialCatalogRaw, searchOfficialCatalog, lookupOfficialCode, OFFICIAL_CATALOG_ENDPOINTS,
} from "../server/services/officialCatalogService";
import { normalizeCatalogDescription, type OfficialCatalogType } from "../server/domain/officialCatalog";
import { CATALOG_CONFIG } from "../server/config/catalog";

async function check(type: OfficialCatalogType, term: string): Promise<boolean> {
  console.log(`\n=== ${type.toUpperCase()} — "${term}" (${CATALOG_CONFIG.baseUrl}${OFFICIAL_CATALOG_ENDPOINTS[type]})`);
  const raw = await fetchOfficialCatalogRaw(type, { descricaoItem: term, pagina: "1", tamanhoPagina: "10", statusItem: "true" });
  if (!raw.ok) { console.log(`  INDISPONÍVEL: ${raw.reason} — ${raw.detail}`); return false; }
  const env = raw.json && typeof raw.json === "object" ? (raw.json as Record<string, unknown>) : {};
  console.log(`  envelope: ${Object.keys(env).join(", ") || "(lista na raiz)"}`);
  const res = await searchOfficialCatalog({ catalogType: type, term });
  if (res.status !== "ok") { console.log(`  PARSER: ${res.reason} — ${res.detail}`); return false; }
  const words = normalizeCatalogDescription(term).split(" ").filter((w) => w.length > 2);
  const matching = res.entries.filter((e) => words.some((w) => normalizeCatalogDescription(e.description).includes(w))).length;
  console.log(`  linhas reconhecidas: ${res.entries.length} (descartadas: ${res.discardedRows}; total informado: ${res.total ?? "n/d"})`);
  console.log(`  ativas: ${res.entries.filter((e) => e.active === true).length}; situação não informada: ${res.entries.filter((e) => e.active === null).length}`);
  console.log(`  filtro por descrição efetivo: ${matching}/${res.entries.length} contêm o termo`);
  for (const e of res.entries.slice(0, 3)) console.log(`   - ${e.code} | ${e.active} | ${e.description.slice(0, 90)}`);
  const first = res.entries[0];
  if (!first) { console.log("  nenhuma linha para conferir por código"); return false; }
  const look = await lookupOfficialCode({ catalogType: type, code: first.code });
  console.log(`  consulta por código ${first.code}: ${look.status}${look.status === "found" ? ` (descrição idêntica: ${look.entry.description === first.description})` : ""}`);
  return res.entries.length > 0 && matching > 0 && look.status === "found";
}

async function main(): Promise<void> {
  const [catmatTerm = "notebook", catserTerm = "limpeza"] = process.argv.slice(2).filter((a) => a !== "--");
  const okMat = await check("catmat", catmatTerm);
  const okSer = await check("catser", catserTerm);
  console.log(`\n[CATALOGO-OFICIAL-SMOKE] CATMAT=${okMat ? "OK" : "FALHA"} CATSER=${okSer ? "OK" : "FALHA"}`);
  process.exit(okMat && okSer ? 0 : 1);
}

void main();
