/**
 * R9 / SEM-057 — pré-condições SEMÂNTICAS da emissão oficial (ETP/TR/Edital), regra pura.
 *
 * A emissão governada já exigia papel, SoD, hash revisado e idempotência — mas emitia um rascunho com
 * marcadores `[REVISAR…]`, com fontes alteradas depois da geração, um Edital sem TR emitido e uma nova versão
 * idêntica à última emitida. Agora a emissão é recusada (PRECONDITION_FAILED) com a lista dos bloqueios, e a UI
 * mostra os mesmos bloqueios ANTES do clique.
 *
 * LICIGOV-FAST S1 — os marcadores `[REVISAR…]` têm origens diferentes (dado não informado, narrativa de IA pendente, lacuna
 * apontada pela IA, valor a conferir, preço de referência, fonte alterada). A mensagem passa a dizer QUAIS são e onde resolver,
 * mas o CRITÉRIO de bloqueio é o mesmo de sempre (`countReviewMarkers` > 0 ⇒ EMISSION_REVIEW_MARKERS): a classificação é só
 * apresentação, nunca libera nem bloqueia nada, e remover o texto do marcador não contorna as verificações estruturadas
 * (preço fictício, fontes alteradas, revalidação do modelo).
 */
import { MISSING_VALUE_MARK, PENDING_AI_SLOT_MARK } from "./institutionalTemplates/composerShared";
import { UNVERIFIED_AMOUNT_MARK } from "./aiNumericAuthority";
import { FICTITIOUS_PRICE_CELL_TEXT, QUANTITY_NOT_INFORMED_TEXT } from "./authoritativeItems";

export type EmissionBlockerCode =
  | "EMISSION_REVIEW_MARKERS"
  | "EMISSION_SOURCES_CHANGED"
  | "EMISSION_TR_NOT_EMITTED"
  | "EMISSION_NO_CHANGES"
  | "EMISSION_FICTITIOUS_PRICES";

export interface EmissionBlocker {
  readonly code: EmissionBlockerCode;
  readonly message: string;
  /** S1 — só para EMISSION_REVIEW_MARKERS: contagem por tipo (apresentação; o bloqueio não depende disto). */
  readonly details?: { readonly reviewMarkers: ReviewMarkerSummary };
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

// ─── S1: classificação dos marcadores (apresentação) ───────────────────────────────────────────────────────────────

export type ReviewMarkerCategory =
  | "missing_info" | "ai_narrative_pending" | "ai_gap" | "amount_unverified" | "reference_price" | "source_changed" | "generic";

/** Ordem de apresentação (e de precedência quando um texto casa mais de uma regra). */
export const REVIEW_MARKER_CATEGORIES: readonly ReviewMarkerCategory[] = [
  "missing_info", "ai_narrative_pending", "ai_gap", "amount_unverified", "reference_price", "source_changed", "generic",
];

export interface ReviewMarkerSummary {
  /** Sempre igual a `countReviewMarkers` (mesmo gatilho `[REVISAR`): a classificação nunca cria outro critério de contagem. */
  readonly total: number;
  readonly byCategory: Readonly<Partial<Record<ReviewMarkerCategory, number>>>;
  /** Onde resolver, SÓ quando o texto vem de um produtor conhecido do sistema (nunca inventado). */
  readonly resolveAt: readonly string[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Padrão literal de um produtor `(x) => "...x..."` — sem duplicar o texto do produtor. `arg` restringe o argumento ao formato que o
 * produtor realmente usa (ex.: nome de variável do catálogo), para que texto livre da IA parecido não herde um "onde resolver" falso.
 */
const producerPattern = (fn: (arg: string) => string, arg: string): RegExp => {
  const probe = "\u0000";
  const [pre, post] = fn(probe).split(probe);
  return new RegExp(`^${escapeRe(pre)}${arg}${escapeRe(post)}`);
};
/** Nome de variável do catálogo (ex.: `contratacao.prazoExecucao`): sem espaços — é o que o composer passa a `MISSING_VALUE_MARK`. */
const CATALOG_VARIABLE_ARG = "[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)+";
const literal = (text: string): RegExp => new RegExp(`^${escapeRe(text)}`);

interface Rule { readonly category: ReviewMarkerCategory; readonly re: RegExp; readonly resolveAt?: string }

/**
 * Regras por PRODUTOR conhecido (composer, quadro/estimativa redigidos pelo servidor, contexto de autoria). A ordem importa:
 * o mais específico primeiro (ex.: "preço suspenso — fonte da pesquisa alterada" é preço de referência). Texto livre com
 * dois-pontos que não casa nenhum produtor é lacuna apontada pela IA; o resto é revisão genérica.
 */
const RULES: readonly Rule[] = [
  { category: "ai_narrative_pending", re: producerPattern(PENDING_AI_SLOT_MARK, '[^"\\]\\n]+') },
  { category: "amount_unverified", re: literal(UNVERIFIED_AMOUNT_MARK), resolveAt: "quadro de itens deste documento" },
  { category: "reference_price", re: literal(FICTITIOUS_PRICE_CELL_TEXT), resolveAt: "Pesquisa de Preços" },
  { category: "reference_price", re: /^\[REVISAR: (?:preço suspenso|sem preço\]|unidade da cotação|\d+ cotação\(ões\)|\d+ item\(ns\) sem preço de referência)/, resolveAt: "Pesquisa de Preços" },
  { category: "source_changed", re: /^\[REVISAR: fonte da pesquisa alterada após a decisão\]/, resolveAt: "Pesquisa de Preços" },
  { category: "missing_info", re: literal(QUANTITY_NOT_INFORMED_TEXT), resolveAt: "Itens da contratação" },
  { category: "missing_info", re: /^\[REVISAR: (?:\d+ item\(ns\) sem quantidade (?:prevista|informada)|a quantidade é a da COTAÇÃO)/, resolveAt: "Itens da contratação" },
  { category: "missing_info", re: /^\[REVISAR: nenhum (?:Item|item) (?:aprovado|Inteligente)/, resolveAt: "Itens da contratação e Pesquisa de Preços" },
  { category: "missing_info", re: /^\[REVISAR: objeto não informado\]/, resolveAt: "dados do processo" },
  { category: "missing_info", re: /^\[REVISAR: definir (?:critério de julgamento|regime de execução)/, resolveAt: "parâmetros do Edital" },
  { category: "missing_info", re: /^\[REVISAR: [^\]\n]* não localizado no processo/, resolveAt: "documento anterior do processo" },
  { category: "missing_info", re: producerPattern(MISSING_VALUE_MARK, CATALOG_VARIABLE_ARG), resolveAt: "dados do processo usados pelo modelo institucional" },
  { category: "ai_gap", re: /^\[REVISAR:/ },
];

const MARKER_TEXT = /\[REVISAR\b[^\][\n]*\]?/g;

export function classifyReviewMarkers(content: string): ReviewMarkerSummary {
  const byCategory: Partial<Record<ReviewMarkerCategory, number>> = {};
  const resolveAt = new Set<string>();
  const found = content.match(MARKER_TEXT) ?? [];
  for (const text of found) {
    const rule = RULES.find((r) => r.re.test(text));
    const category = rule?.category ?? "generic";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    if (rule?.resolveAt) resolveAt.add(rule.resolveAt);
  }
  return { total: found.length, byCategory, resolveAt: [...resolveAt] };
}

const CATEGORY_TEXT: Readonly<Record<ReviewMarkerCategory, (n: number) => string>> = {
  missing_info: (n) => `${n} informação(ões) ainda não informada(s)`,
  ai_narrative_pending: (n) => `${n} trecho(s) gerado(s) com IA aguardando revisão humana`,
  ai_gap: (n) => `${n} lacuna(s) apontada(s) na redação, que precisa(m) de revisão humana`,
  amount_unverified: (n) => `${n} valor(es) que precisa(m) ser conferido(s) com o quadro de itens`,
  reference_price: (n) => `${n} pendência(s) no preço de referência`,
  source_changed: (n) => `${n} referência(s) a fonte alterada depois da decisão`,
  generic: (n) => `${n} revisão(ões) pendente(s)`,
};

/** Mensagem operacional do bloqueio por marcadores (mesmo bloqueio; texto mais útil). */
export function reviewMarkersMessage(s: ReviewMarkerSummary): string {
  const parts = REVIEW_MARKER_CATEGORIES.filter((c) => (s.byCategory[c] ?? 0) > 0).map((c) => CATEGORY_TEXT[c](s.byCategory[c]!));
  const where = s.resolveAt.length ? ` Onde resolver: ${s.resolveAt.join("; ")}.` : "";
  return `O conteúdo ainda tem ${s.total} marcador(es) [REVISAR]: ${parts.join("; ")}.${where} Complete ou revise os trechos e salve antes de emitir — apagar o marcador não resolve a pendência de origem.`;
}

export function emissionBlockers(input: EmissionPreconditionInput): EmissionBlocker[] {
  const out: EmissionBlocker[] = [];
  const markers = countReviewMarkers(input.content);
  if (markers > 0) {
    // Critério INALTERADO (markers > 0). A classificação só melhora a mensagem; o total é o mesmo da contagem.
    const summary = classifyReviewMarkers(input.content);
    out.push({ code: "EMISSION_REVIEW_MARKERS", message: reviewMarkersMessage({ ...summary, total: markers }), details: { reviewMarkers: summary } });
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
