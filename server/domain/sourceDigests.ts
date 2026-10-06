/**
 * R9 / SEM-047 — DIGEST POR FONTE dos documentos gerados (ETP/TR/Edital).
 *
 * O digest global único tinha falso positivo (contagem de itens pendentes, status/origem do DFD) e falso negativo
 * (mudança fora do recorte de 6000/4000 caracteres não mudava nada), e a UI só dizia "fontes mudaram". Agora a
 * geração grava UM marcador por fonte (`srcd:<fonte>=<hash12>`), com hash do CONTEÚDO INTEGRAL da fonte autoritativa,
 * e a comparação devolve QUAIS fontes mudaram. Documentos gerados antes (sem `srcd:`) continuam comparados pelo
 * digest global legado — nenhum documento existente muda de estado só por causa desta versão.
 */
import { createHash } from "crypto";

export const SOURCE_DIGEST_PREFIX = "srcd:";

export type SourceKey = "processo" | "dfd" | "etp" | "tr" | "itens" | "parametros";

export const SOURCE_LABELS: Record<SourceKey, string> = {
  processo: "Dados do processo (objeto/número)",
  dfd: "DFD",
  etp: "ETP",
  tr: "Termo de Referência",
  itens: "Itens / quantidades / preços",
  parametros: "Parâmetros do Edital",
};

/** Hash estável de um valor JSON (chaves na ordem dada pelo chamador). */
export function sourceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 12);
}

export function sourceDigestMarkers(digests: Partial<Record<SourceKey, string>>): string[] {
  return (Object.keys(digests) as SourceKey[]).sort().map((k) => `${SOURCE_DIGEST_PREFIX}${k}=${digests[k]}`);
}

export function parseSourceDigestMarkers(sources: readonly string[] | null | undefined): Partial<Record<SourceKey, string>> | null {
  const out: Partial<Record<SourceKey, string>> = {};
  let any = false;
  for (const s of sources ?? []) {
    if (!s.startsWith(SOURCE_DIGEST_PREFIX)) continue;
    const [k, v] = s.slice(SOURCE_DIGEST_PREFIX.length).split("=");
    if (k && v && k in SOURCE_LABELS) { out[k as SourceKey] = v; any = true; }
  }
  return any ? out : null;
}

/** Fontes cujo hash mudou (inclui fonte que apareceu/sumiu). Ordem estável pela lista de rótulos. */
export function changedSources(stored: Partial<Record<SourceKey, string>>, current: Partial<Record<SourceKey, string>>): SourceKey[] {
  return (Object.keys(SOURCE_LABELS) as SourceKey[]).filter((k) => (stored[k] ?? null) !== (current[k] ?? null));
}

export type SourceComparison =
  | { mode: "per_source"; state: "current" | "source_changed"; changed: SourceKey[] }
  | { mode: "legacy_global"; state: "current" | "source_changed"; changed: [] };

/**
 * Compara as fontes de um documento existente com as atuais: por fonte quando o documento tem marcadores `srcd:`;
 * senão, pelo digest global legado (`srcdigest:` — prefixo de 16 chars).
 */
export function compareSources(
  storedSources: readonly string[] | null | undefined,
  current: { perSource: Partial<Record<SourceKey, string>>; globalDigest: string },
): SourceComparison {
  const stored = parseSourceDigestMarkers(storedSources);
  if (stored) {
    const changed = changedSources(stored, current.perSource);
    return { mode: "per_source", state: changed.length ? "source_changed" : "current", changed };
  }
  const legacy = (storedSources ?? []).find((s) => s.startsWith("srcdigest:"))?.slice("srcdigest:".length) ?? null;
  return { mode: "legacy_global", state: legacy !== null && legacy === current.globalDigest.slice(0, 16) ? "current" : "source_changed", changed: [] };
}
