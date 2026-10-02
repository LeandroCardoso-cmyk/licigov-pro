/**
 * R9 / SEM-039 — AUTORIDADE das fontes a montante (DFD → ETP → TR → Edital).
 *
 * Um documento a jusante consome a versão AUTORITATIVA do documento a montante:
 *   1. a última versão `emitido` em `official_documents` (ETP/TR/Edital promovidos pela emissão governada);
 *   2. sem emissão, o rascunho operacional — rotulado como `aprovado` (revisão humana concluída) ou `rascunho`.
 * O rótulo vai para o prompt ("estado: emitido v2" / "RASCUNHO não emitido") e para a lineage (`autoridade:tr=…`),
 * em vez do antigo marcador fixo `"tr_aprovado"` (que afirmava uma aprovação que nunca foi verificada).
 * Tenant-scoped: documento de outro órgão não é encontrado (ausente).
 */
import { getGeneratedDocumentByKind } from "../../db/procurement";
import { getLatestEmittedByOrigin } from "../../db/officialDocuments";

export type UpstreamAuthority = "emitido" | "aprovado" | "rascunho";
export type UpstreamKind = "dfd" | "etp" | "tr";

/** Tipos que a emissão oficial governada promove (o DFD não é promovível — vale o rascunho/aprovação). */
const EMITTABLE: ReadonlySet<UpstreamKind> = new Set(["etp", "tr"]);
const BUSINESS_DOMAIN = "processo_licitatorio";

export interface AuthoritativeUpstream {
  readonly content: string;
  readonly status: string | null;
  readonly sources: readonly string[];
  readonly authority: UpstreamAuthority;
  /** Versão emitida (null quando a fonte é o rascunho). */
  readonly version: number | null;
}

/** Rótulo de autoridade de um rascunho (sem versão emitida). */
export function draftAuthority(status: string | null | undefined): UpstreamAuthority {
  return status === "aprovado" ? "aprovado" : "rascunho";
}

/** Marcador de lineage da autoridade consumida (ex.: `autoridade:tr=emitido:v2`, `autoridade:dfd=rascunho`). */
export function authorityMarker(kind: UpstreamKind, up: { authority?: UpstreamAuthority; version?: number | null } | null): string {
  if (!up?.authority) return `autoridade:${kind}=ausente`;
  return `autoridade:${kind}=${up.authority}${up.authority === "emitido" && up.version ? `:v${up.version}` : ""}`;
}

/** Texto do estado renderizado no prompt. */
export function authorityLabel(up: { authority?: UpstreamAuthority; version?: number | null; status?: string | null }): string {
  if (up.authority === "emitido") return `emitido${up.version ? ` v${up.version}` : ""} — versão oficial`;
  if (up.authority === "aprovado") return "aprovado (revisado; ainda NÃO emitido)";
  if (up.authority === "rascunho") return "RASCUNHO não emitido — [REVISAR: confirmar o conteúdo antes de emitir este documento]";
  return up.status ?? "?";
}

export async function resolveAuthoritativeUpstream(organizationId: number, processId: string, kind: UpstreamKind): Promise<AuthoritativeUpstream | null> {
  if (EMITTABLE.has(kind)) {
    const emitted = await getLatestEmittedByOrigin(organizationId, BUSINESS_DOMAIN, processId, kind);
    if (emitted && emitted.content.trim()) {
      return { content: emitted.content, status: "emitido", sources: [], authority: "emitido", version: emitted.version };
    }
  }
  const draft = await getGeneratedDocumentByKind(processId, organizationId, kind);
  if (!draft) return null;
  return { content: draft.content ?? "", status: draft.status ?? null, sources: draft.sources ?? [], authority: draftAuthority(draft.status), version: null };
}
