/* eslint-disable no-console -- CLI operacional: o relatório é a saída no terminal */
/**
 * Sincronização EXPLÍCITA e LIMITADA do índice de pesquisa de um catálogo oficial (operação de plataforma).
 *
 * Uso (Console do Railway do ambiente; grava no banco DESSE ambiente, organização global 0 — nenhum órgão):
 *   pnpm catalog:sync -- catser                          # padrão: tamanhoPagina 100, até 100 páginas
 *   pnpm catalog:sync -- catser --page-size 500 --max-pages 40
 *
 * - Só lê a API oficial (uma vez por página, sem cache) e grava um snapshot VERSIONADO (checksum do catálogo inteiro).
 * - Falha no meio ⇒ nada gravado (o índice anterior continua valendo). Atingir o limite de páginas ⇒ snapshot PARCIAL.
 * - O índice só serve para ENCONTRAR candidatos; cada sugestão é verificada por código na fonte antes de ser exibida.
 */
import { syncCatalogIndex } from "../server/services/itemCatalogClassificationService";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? parseInt(process.argv[i + 1] ?? "", 10) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

async function main(): Promise<void> {
  // Só o CATSER usa índice (a API não tem filtro textual); o CATMAT é pesquisado na própria fonte — não varrer o catálogo.
  const type = process.argv.slice(2).find((a) => a === "catser");
  if (!type) { console.error("Uso: pnpm catalog:sync -- catser [--page-size N] [--max-pages N]"); process.exit(2); }
  const pageSize = arg("--page-size", 100);
  const maxPages = arg("--max-pages", 100);
  console.log(`[CATALOGO-SYNC] ${type.toUpperCase()} — tamanhoPagina ${pageSize}, até ${maxPages} página(s)`);
  const res = await syncCatalogIndex({
    catalogType: type, pageSize, maxPages, correlationId: `catalog-sync-${type}-${Date.now()}`,
    onPage: (page, rows) => { if (page === 1 || page % 10 === 0) console.log(`  página ${page}: ${rows} linha(s)`); },
  });
  console.log(`[CATALOGO-SYNC] ${JSON.stringify(res)}`);
  process.exit(res.status === "synced" ? 0 : 1);
}

void main();
