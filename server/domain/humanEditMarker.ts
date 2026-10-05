/**
 * R10 / SEM-044 — MARCADOR de edição humana no rascunho (ETP/TR/Edital), sem coluna nova.
 *
 * A edição humana governada (`human_edit`) é CONTENT-ONLY: preserva `sources` (lineage de geração). Sem marcador, um
 * ETP reescrito por uma pessoa continuava aparecendo como "gerado". Agora cada `human_edit` que MUDA o conteúdo grava,
 * em `generated_documents.sources` (coluna existente), três marcadores estáveis:
 *   - `edicao_humana`                     — origem humana (mesmo marcador já reconhecido por regeneração/importação);
 *   - `edicao_humana:ator=<userId>`       — quem editou por último (humano `user:<id>`, nunca IA);
 *   - `edicao_humana:hash=<sha256[0..16]>` — hash do conteúdo editado (liga o marcador ao ledger `generated_document_edits`).
 * Os marcadores de lineage de geração (`ai:`, `srcd:`, `srcdigest:`…) são PRESERVADOS. Regeneração (que reconstrói
 * `sources`) descarta o marcador — o conteúdo volta a ser "gerado". Linhas antigas ficam como estão (sem backfill): a
 * origem delas vem do ledger de edições quando existir (`resolveDraftOrigin`).
 */
import { classifyDraftHumanState, type LastDraftEdit } from "./draftRegeneration";

export const HUMAN_EDIT_SOURCE = "edicao_humana";
const ACTOR_PREFIX = `${HUMAN_EDIT_SOURCE}:ator=`;
const HASH_PREFIX = `${HUMAN_EDIT_SOURCE}:hash=`;

export type DraftOrigin = "import" | "generated" | "manual";

/** `sources` com o marcador de edição humana (idempotente: substitui ator/hash anteriores; preserva o resto e a ordem). */
export function withHumanEditMarker(sources: readonly string[], actorUserId: number, contentHash: string): string[] {
  const kept = sources.filter((s) => s !== HUMAN_EDIT_SOURCE && !s.startsWith(ACTOR_PREFIX) && !s.startsWith(HASH_PREFIX));
  return [...kept, HUMAN_EDIT_SOURCE, `${ACTOR_PREFIX}${actorUserId}`, `${HASH_PREFIX}${contentHash.slice(0, 16)}`];
}

/** Marcador de edição humana vigente (ator/hash) — null quando o rascunho não tem edição humana registrada em `sources`. */
export function readHumanEditMarker(sources: readonly string[]): { actorUserId: number | null; contentHash: string | null } | null {
  if (!sources.includes(HUMAN_EDIT_SOURCE)) return null;
  const actor = sources.find((s) => s.startsWith(ACTOR_PREFIX))?.slice(ACTOR_PREFIX.length);
  const hash = sources.find((s) => s.startsWith(HASH_PREFIX))?.slice(HASH_PREFIX.length);
  const id = actor !== undefined && /^\d+$/.test(actor) ? Number(actor) : null;
  return { actorUserId: id, contentHash: hash ?? null };
}

/**
 * Origem do conteúdo vigente: importado > editado por humano > gerado. Fonte da verdade, em ordem: marcadores de
 * `sources` (inclusive os legados `edicao_manual`/`edicao_humana`) e, para linhas sem marcador, o ÚLTIMO registro do ledger
 * de edições QUANDO o hash dele descreve o conteúdo vigente (evidência real; nunca inventada).
 */
export function resolveDraftOrigin(
  draft: { readonly content: string; readonly sources?: readonly string[] | null },
  lastEdit: LastDraftEdit | null | undefined,
): DraftOrigin {
  const sources = draft.sources ?? [];
  if (sources.includes("origem:import")) return "import";
  if (sources.some((s) => s === "edicao_manual" || s === HUMAN_EDIT_SOURCE)) return "manual";
  if (lastEdit) {
    const st = classifyDraftHumanState(draft, lastEdit);
    if (st.human && st.reason === "import") return "import";
    if (st.human && st.reason === "human_edit") return "manual";
  }
  return "generated";
}
