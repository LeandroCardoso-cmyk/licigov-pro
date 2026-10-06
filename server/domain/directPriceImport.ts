/**
 * R2 / PR-04A — LEG-014 / FCC-01 — Identidade EXPLÍCITA de importação de Pesquisa de Preços na
 * Contratação Direta (domínio puro, determinístico, sem IA/rede/banco).
 *
 * Problema corrigido: o caminho legado (`createPriceResearchWorkspace` + `extractItemsFromText`) deriva
 * o id da pesquisa de `(org, processo, fonte)` e o id da cotação de `(org, pesquisa, índice, descrição)` —
 * uma segunda colagem no MESMO workspace reutilizava os ids e SOBRESCREVIA silenciosamente as cotações da
 * primeira (upsert). Aqui cada importação tem IDENTIDADE PRÓPRIA:
 *
 *   - `contentHash` = SHA-256 do conteúdo NORMALIZADO (itens extraídos: descrição/quantidade/unidade/valor/
 *     fornecedor/marca/modelo/observações — caixa e espaços normalizados, multiconjunto ORDENADO). É
 *     recomputável a partir das cotações persistidas (verificável). A fonte (`colar`, `csv`…) NÃO entra no
 *     hash: é linhagem, não conteúdo — o mesmo conjunto de cotações rotulado com outra fonte é o MESMO
 *     conteúdo (evita inflar o número de cotações com duplicatas);
 *   - `importId` = sha256("dpi:org:workspace:contentHash") — uma pesquisa por conteúdo distinto; NUNCA
 *     coincide com ids do caminho legado (prefixos disjuntos "prw:"/"pri:" × "dpi:"/"dpii:");
 *   - id da cotação = sha256("dpii:org:importId:índice") — escopado à importação, nunca reaproveita a
 *     cotação de outra importação.
 *
 * DEDUP GOVERNADA (decisão documentada): o MESMO conteúdo reimportado no mesmo workspace (inclusive com
 * NOVA chave de idempotência) CONVERGE para a importação existente (`deduplicated: true`) — nenhuma escrita,
 * nenhuma sobrescrita, nenhuma cotação duplicada. Conteúdo diferente ⇒ nova importação que COEXISTE com as
 * anteriores (as cotações anteriores permanecem intactas).
 *
 * O caminho do Processo Licitatório (`procurementProcess.importPriceResearch`) NÃO usa este módulo e tem
 * semântica inalterada.
 */

import { createHash } from "crypto";
import {
  extractItemsFromText,
  type PriceResearchItem,
  type PriceResearchSource,
  type PriceResearchWorkspace,
} from "./priceResearch";

/** Versão do algoritmo de normalização (entra no hash — mudanças futuras não colidem com hashes antigos). */
export const DIRECT_PRICE_IMPORT_HASH_VERSION = "dpi-content-v1";

export interface DirectPriceImportPlan {
  readonly importId: string;
  readonly contentHash: string;
  readonly research: PriceResearchWorkspace;
  readonly items: readonly PriceResearchItem[];
}

const norm = (s: string): string => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Campos de conteúdo de uma cotação usados no hash (forma canônica). */
function canonicalQuote(it: Pick<PriceResearchItem, "description" | "quantity" | "unit" | "value" | "supplier" | "brand" | "model" | "observations">): string {
  return JSON.stringify([
    norm(it.description),
    Number(it.quantity).toFixed(3),
    norm(it.unit || "un"),
    Number(it.value).toFixed(2),
    norm(it.supplier),
    norm(it.brand),
    norm(it.model),
    norm(it.observations),
  ]);
}

/**
 * contentHash do conteúdo normalizado de uma importação. Aceita tanto itens recém-extraídos quanto linhas
 * relidas do banco (quantity/value numéricos ou decimais em string) — o hash é recomputável e verificável.
 */
export function computeDirectPriceImportContentHash(
  items: ReadonlyArray<{ description: string; quantity: number | string; unit: string; value: number | string; supplier: string; brand: string; model: string; observations: string }>,
): string {
  const canon = items
    .map((it) => canonicalQuote({
      description: it.description ?? "", quantity: Number(it.quantity), unit: it.unit ?? "", value: Number(it.value),
      supplier: it.supplier ?? "", brand: it.brand ?? "", model: it.model ?? "", observations: it.observations ?? "",
    }))
    .sort();
  return createHash("sha256").update(`${DIRECT_PRICE_IMPORT_HASH_VERSION}\n${canon.join("\n")}`).digest("hex");
}

/** Identidade da importação — determinística em (org, workspace, contentHash). */
export function deriveDirectPriceImportId(organizationId: number, workspaceId: string, contentHash: string): string {
  return createHash("sha256").update(`dpi:${organizationId}:${workspaceId}:${contentHash}`).digest("hex").slice(0, 20);
}

/** Id da cotação — escopado à importação (nunca reaproveita a cotação de outra importação). */
export function deriveDirectPriceImportItemId(organizationId: number, importId: string, index: number): string {
  return createHash("sha256").update(`dpii:${organizationId}:${importId}:${index}`).digest("hex").slice(0, 20);
}

/** Hash do payload da REQUISIÇÃO (para a idempotência): mesma chave + payload diferente ⇒ CONFLICT. */
export function computeDirectPriceImportPayloadHash(params: {
  operation: string; organizationId: number; workspaceId: string; source: PriceResearchSource; contentHash: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    op: params.operation, o: params.organizationId, ws: params.workspaceId, s: params.source, h: params.contentHash,
  })).digest("hex");
}

/**
 * Planeja uma importação (puro): extrai as cotações com o extrator determinístico EXISTENTE (reuso, sem
 * alterar sua semântica), calcula o contentHash e reidentifica pesquisa e cotações com a identidade
 * explícita da importação. A fonte declarada é gravada como linhagem em cada cotação.
 */
export function planDirectPriceImport(params: {
  workspaceId: string;
  organizationId: number;
  source: PriceResearchSource;
  text: string;
  correlationId: string;
  createdAt?: string;
}): DirectPriceImportPlan {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const extracted = extractItemsFromText(params.text, {
    researchId: "pending", processId: params.workspaceId, organizationId: params.organizationId,
  });
  const contentHash = computeDirectPriceImportContentHash(extracted);
  const importId = deriveDirectPriceImportId(params.organizationId, params.workspaceId, contentHash);
  const items: PriceResearchItem[] = extracted.map((it, index) => ({
    ...it,
    id: deriveDirectPriceImportItemId(params.organizationId, importId, index),
    researchId: importId,
    source: params.source,
    createdAt,
  }));
  const research: PriceResearchWorkspace = {
    id: importId,
    processId: params.workspaceId,
    organizationId: params.organizationId,
    source: params.source,
    itemCount: items.length,
    correlationId: params.correlationId,
    createdAt,
  };
  return { importId, contentHash, research, items };
}
