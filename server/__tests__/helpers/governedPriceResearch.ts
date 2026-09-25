/**
 * Fixture de LINEAGE GOVERNADO da Pesquisa de Preços para smokes MySQL: reproduz exatamente o que a promoção
 * canônica (`importPromotionService.promoteImportSession`) registra — sessão de importação `approved` +
 * `promotionStatus = promoted` + ledger `import_promotions` (targetKind price_research) + `price_research` —
 * para que Itens Inteligentes semeados diretamente tenham origem comprovável (senão NÃO são candidatos).
 */
import type mysql from "mysql2/promise";
import { createHash } from "node:crypto";

const cache = new Map<string, string>();

/** Id da pesquisa governada do processo (cria sessão promovida + ledger + pesquisa na 1ª chamada). */
export async function governedResearchId(conn: mysql.Connection, org: number, processId: string, uploadedBy: number): Promise<string> {
  const key = `${org}:${processId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const researchId = createHash("sha256").update(`fixture-promo:${key}`).digest("hex").slice(0, 20);
  const checksum = createHash("sha256").update(`fixture-file:${key}`).digest("hex");
  const [s] = await conn.execute<mysql.ResultSetHeader>(
    `INSERT INTO import_sessions (organizationId, uploadedBy, sourceFileId, sourceFileName, sourceMimeType, sourceSize, checksum,
       procurementProcessId, importType, status, promotionStatus, promotedAt, promotedByUserId, promotionRef)
     VALUES (?, ?, ?, 'pesquisa.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, ?, ?, 'price_research', 'approved', 'promoted', NOW(), ?, ?)`,
    [org, uploadedBy, `fixture/${key}`, checksum, processId, uploadedBy, researchId],
  );
  await conn.execute(
    "INSERT INTO price_research (id, organization_id, process_id, source, item_count, correlation_id) VALUES (?, ?, ?, 'xlsx', 0, 'fixture')",
    [researchId, org, processId],
  );
  await conn.execute(
    `INSERT INTO import_promotions (organizationId, procurementProcessId, importSessionId, importType, targetKind, targetRef, itemsPromoted, actorUserId, sourceChecksum)
     VALUES (?, ?, ?, 'price_research', 'price_research', ?, 0, ?, ?)`,
    [org, processId, s.insertId, researchId, uploadedBy, checksum],
  );
  cache.set(key, researchId);
  return researchId;
}

/** Tabelas da fixture governada (limpeza por tenant). */
export const GOVERNED_RESEARCH_TABLES = [
  ["import_promotions", "organizationId"], ["import_sessions", "organizationId"], ["price_research", "organization_id"],
] as const;

export function forgetGovernedResearch(org: number): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${org}:`)) cache.delete(k);
}
