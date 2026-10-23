/**
 * Catálogo oficial CATMAT/CATSER — domínio PURO (sem rede nem banco).
 *
 * - `parseOfficialCatalogPayload`: lê a resposta da API do Compras.gov.br de forma tolerante (o envelope pode vir em
 *   `resultado` ou `data`; materiais e serviços usam nomes de campo diferentes) e FAIL-CLOSED: linha sem código numérico
 *   ou sem descrição é descartada; resposta sem lista é "malformada". Situação ativa/inativa só é `true` quando a fonte
 *   declara — sem o campo, a entrada não é confirmável.
 * - `catalogEvidenceChecksum`: checksum determinístico da evidência (consulta + entradas), base do snapshot.
 * - `verifySuggestionAgainstEvidence`: uma sugestão só é VERIFICADA quando o código consta de uma consulta oficial
 *   registrada para o órgão, com a MESMA descrição oficial e situação ativa. Código gerado localmente (hash), sugestão
 *   legada ou descrição divergente ⇒ não verificada (nunca confirmável como oficial).
 */
import { createHash } from "crypto";

export type OfficialCatalogType = "catmat" | "catser";

export const OFFICIAL_CATALOG_SOURCE = "api-comprasgov" as const;

/** Rótulo de proveniência gravado no ledger/sugestão (cabe em varchar(40)). */
export function officialSourceLabel(type: OfficialCatalogType): string {
  return `${OFFICIAL_CATALOG_SOURCE}:${type}`;
}

/** Sugestão persistida sem evidência oficial (inclui os candidatos gerados localmente antes desta correção). */
export const UNVERIFIED_SOURCE = "sem-proveniencia" as const;

export interface OfficialCatalogEntry {
  readonly catalogType: OfficialCatalogType;
  readonly code: string;
  readonly description: string;
  /** true = ativa declarada pela fonte; false = inativa; null = a fonte não informou (não confirmável). */
  readonly active: boolean | null;
  readonly group: string | null;
}

export type ParsedCatalogPayload =
  | { readonly ok: true; readonly entries: OfficialCatalogEntry[]; readonly total: number | null; readonly discardedRows: number }
  | { readonly ok: false; readonly reason: "malformed" };

const CODE_FIELDS = ["codigoItem", "codigoServico", "codigo"] as const;
const DESCRIPTION_FIELDS = ["descricaoItem", "nomeServico", "descricaoServico", "descricao", "nomeItem"] as const;
const STATUS_FIELDS = ["statusItem", "statusServico", "status", "ativo"] as const;
const GROUP_FIELDS = ["nomeGrupo", "nomeClasse", "nomePdm", "nomeSubclasse"] as const;

function firstField(row: Record<string, unknown>, fields: readonly string[]): unknown {
  for (const f of fields) if (row[f] !== undefined && row[f] !== null && row[f] !== "") return row[f];
  return undefined;
}

function readActive(v: unknown): boolean | null {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "ativo" || s === "1") return true;
    if (s === "false" || s === "inativo" || s === "0") return false;
  }
  return null;
}

export function parseOfficialCatalogPayload(raw: unknown, catalogType: OfficialCatalogType): ParsedCatalogPayload {
  const envelope = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rows = Array.isArray(raw) ? raw : envelope ? (envelope.resultado ?? envelope.data) : undefined;
  if (!Array.isArray(rows)) return { ok: false, reason: "malformed" };
  const entries: OfficialCatalogEntry[] = [];
  let discardedRows = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") { discardedRows++; continue; }
    const row = r as Record<string, unknown>;
    const codeRaw = firstField(row, CODE_FIELDS);
    const code = typeof codeRaw === "number" && Number.isInteger(codeRaw) ? String(codeRaw) : typeof codeRaw === "string" ? codeRaw.trim() : "";
    const descRaw = firstField(row, DESCRIPTION_FIELDS);
    const description = typeof descRaw === "string" ? descRaw.replace(/\s+/g, " ").trim() : "";
    if (!/^\d{1,9}$/.test(code) || description.length === 0) { discardedRows++; continue; }
    const groupRaw = firstField(row, GROUP_FIELDS);
    entries.push({
      catalogType, code, description,
      active: readActive(firstField(row, STATUS_FIELDS)),
      group: typeof groupRaw === "string" ? groupRaw.trim() || null : null,
    });
  }
  if (rows.length > 0 && entries.length === 0) return { ok: false, reason: "malformed" };
  const totalRaw = envelope?.totalRegistros ?? envelope?.total;
  return { ok: true, entries, total: typeof totalRaw === "number" ? totalRaw : null, discardedRows };
}

/** Normalização usada SÓ para comparar descrições (a descrição oficial é gravada como veio). */
export function normalizeCatalogDescription(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function catalogEvidenceChecksum(p: {
  catalogType: OfficialCatalogType; query: { term?: string; code?: string; page: number; pageSize: number };
  entries: readonly OfficialCatalogEntry[];
}): string {
  const canonical = JSON.stringify({
    t: p.catalogType,
    q: { term: p.query.term ? normalizeCatalogDescription(p.query.term) : null, code: p.query.code ?? null, page: p.query.page, size: p.query.pageSize },
    e: [...p.entries].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .map((e) => [e.code, e.description, e.active]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Evidência oficial registrada para o órgão (catalog_entries + catalog_snapshots). */
export interface CatalogEvidence {
  readonly catalogType: OfficialCatalogType;
  readonly code: string;
  readonly description: string;
  readonly active: boolean | null;
  readonly snapshotId: string;
  readonly checksum: string;
  readonly retrievedAt: string;
}

export interface SuggestionVerification {
  readonly verified: boolean;
  readonly source: string;
  readonly catalogType: OfficialCatalogType | null;
  readonly evidence: CatalogEvidence | null;
  /** Motivo legível quando não verificada. */
  readonly reason: string | null;
}

export function verifySuggestionAgainstEvidence(
  suggestion: { catmatCode: string; catmatDescription: string },
  evidence: readonly CatalogEvidence[],
): SuggestionVerification {
  const code = suggestion.catmatCode.trim();
  const desc = normalizeCatalogDescription(suggestion.catmatDescription ?? "");
  const sameCode = evidence.filter((e) => e.code === code);
  if (sameCode.length === 0) {
    return { verified: false, source: UNVERIFIED_SOURCE, catalogType: null, evidence: null, reason: "Código sem consulta oficial registrada para este órgão." };
  }
  const exact = sameCode.find((e) => normalizeCatalogDescription(e.description) === desc);
  if (!exact) {
    return { verified: false, source: UNVERIFIED_SOURCE, catalogType: null, evidence: null, reason: "A descrição da sugestão não corresponde à descrição oficial do código." };
  }
  if (exact.active !== true) {
    return {
      verified: false, source: officialSourceLabel(exact.catalogType), catalogType: exact.catalogType, evidence: exact,
      reason: exact.active === false ? "Código inativo no catálogo oficial." : "A fonte oficial não informou a situação (ativa/inativa) do código.",
    };
  }
  return { verified: true, source: officialSourceLabel(exact.catalogType), catalogType: exact.catalogType, evidence: exact, reason: null };
}
