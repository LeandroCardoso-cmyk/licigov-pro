/**
 * R9 / SEM-057 — pré-condições SEMÂNTICAS da emissão oficial (ETP/TR/Edital), regra pura.
 *
 * A emissão governada já exigia papel, SoD, hash revisado e idempotência — mas emitia um rascunho com
 * marcadores `[REVISAR…]`, com fontes alteradas depois da geração, um Edital sem TR emitido e uma nova versão
 * idêntica à última emitida. Agora a emissão é recusada (PRECONDITION_FAILED) com a lista dos bloqueios, e a UI
 * mostra os mesmos bloqueios ANTES do clique.
 */
export type EmissionBlockerCode =
  | "EMISSION_REVIEW_MARKERS"
  | "EMISSION_SOURCES_CHANGED"
  | "EMISSION_TR_NOT_EMITTED"
  | "EMISSION_NO_CHANGES"
  | "EMISSION_FICTITIOUS_PRICES";

export interface EmissionBlocker {
  readonly code: EmissionBlockerCode;
  readonly message: string;
}

export interface EmissionPreconditionInput {
  readonly kind: "etp" | "tr" | "edital";
  readonly content: string;
  readonly contentHash: string;
  /** Estado das fontes do rascunho frente às atuais (`source_changed` bloqueia). */
  readonly sourceState: string;
  readonly changedSourceLabels: readonly string[];
  /** Edital: existe TR com versão `emitido`? (ignorado para ETP/TR). */
  readonly trEmitted: boolean;
  /** Hash da última versão emitida deste tipo (null = nunca emitido). */
  readonly lastEmittedContentHash: string | null;
  readonly lastEmittedVersion: number | null;
  /**
   * M8 (política de 20/10/2026) — itens cuja referência de preço deriva de cotação FICTÍCIA, calculado das FONTES
   * (nunca do texto): remover o marcador `[REVISAR]` do rascunho não libera a emissão. 0/ausente ⇒ sem bloqueio
   * (inclui a homologação sintética autorizada no backend).
   */
  readonly fictitiousPriceItemCount?: number;
}

const REVIEW_MARKER = /\[REVISAR\b/g;

export function countReviewMarkers(content: string): number {
  return (content.match(REVIEW_MARKER) ?? []).length;
}

export function emissionBlockers(input: EmissionPreconditionInput): EmissionBlocker[] {
  const out: EmissionBlocker[] = [];
  const markers = countReviewMarkers(input.content);
  if (markers > 0) {
    out.push({ code: "EMISSION_REVIEW_MARKERS", message: `O conteúdo ainda tem ${markers} marcador(es) [REVISAR] — resolva-os e salve antes de emitir.` });
  }
  if (input.sourceState === "source_changed") {
    const what = input.changedSourceLabels.length ? `: ${input.changedSourceLabels.join(", ")}` : "";
    // Com versão oficial já emitida, a regeneração direta é recusada (`OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE`) e a
    // edição do rascunho não atualiza as fontes registradas: orientar a "regenerar" seria um beco sem saída.
    out.push(input.lastEmittedVersion !== null
      ? {
        code: "EMISSION_SOURCES_CHANGED",
        message: `As fontes do processo mudaram depois da emissão da versão oficial v${input.lastEmittedVersion}${what}. A versão emitida continua válida e preservada. Emitir uma nova versão exige o ciclo de nova versão governada, ainda não disponível — a regeneração direta não é permitida para documento já emitido.`,
      }
      : { code: "EMISSION_SOURCES_CHANGED", message: `As fontes do processo mudaram depois da geração deste documento${what} — gere novamente o rascunho (e revise) antes de emitir.` });
  }
  if (input.kind === "edital" && !input.trEmitted) {
    out.push({ code: "EMISSION_TR_NOT_EMITTED", message: "O Edital só pode ser emitido depois do Termo de Referência emitido (ordem DFD → ETP → TR → Edital)." });
  }
  if ((input.fictitiousPriceItemCount ?? 0) > 0) {
    out.push({
      code: "EMISSION_FICTITIOUS_PRICES",
      message: `A Pesquisa de Preços de ${input.fictitiousPriceItemCount} item(ns) contém cotação identificada como fictícia, que não constitui pesquisa de preços oficial — o preço desses itens fica suspenso e o documento não pode ser emitido até que a referência seja fundamentada em cotações reais.`,
    });
  }
  if (input.lastEmittedContentHash !== null && input.lastEmittedContentHash === input.contentHash) {
    out.push({ code: "EMISSION_NO_CHANGES", message: `O conteúdo é idêntico à versão oficial já emitida (v${input.lastEmittedVersion ?? "?"}) — nada a emitir.` });
  }
  return out;
}

/** Diferença simples por linhas entre a última versão emitida e o conteúdo a emitir (para a UI). */
export function lineDiffStats(previous: string | null, next: string): { added: number; removed: number } | null {
  if (previous === null) return null;
  const count = (lines: string[]) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const a = count(previous.split("\n"));
  const b = count(next.split("\n"));
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}
