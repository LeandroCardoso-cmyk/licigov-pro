/**
 * M8 (homologação visual) — apresentação PURA do resumo de fontes de autoria (ETP/TR), sem React/rede.
 *
 * Os números vêm do servidor (`authoringSourceState.summary`, o MESMO `estimate` que monta o quadro do documento); aqui só se
 * decide como dizê-los sem induzir a erro:
 *  - nenhum item com preço de referência ⇒ valor estimado INDISPONÍVEL (nunca "R$ 0,00");
 *  - cotação importada com preço ≠ cotação que serve de referência (fictícia nunca é pesquisa de preços oficial);
 *  - documento emitido/aprovado ⇒ "fontes mudaram" não sugere regeneração (o servidor a recusa).
 */
import { formatCentsBRL } from "@/lib/money";
import { globalEstimateLabel } from "@shared/estimateLabel";
import { quoteCountText } from "./itemSourceUpdateView";
import type { RegenerationBlock } from "./regenerationGuard";

export interface SourcesPriceSummary {
  readonly approvedItems: number;
  readonly quoteCount: number;
  readonly pricedItems: number;
  readonly unpricedItems: number;
  readonly estimatedGlobalTotalCents: number;
  /** Ausente em respostas antigas ⇒ 0 (nenhuma fictícia/suspensão conhecida). */
  readonly fictitiousQuoteCount?: number;
  readonly priceSuspendedItems?: number;
  readonly fictitiousPriceItems?: number;
  readonly unknownQuantityItems?: number;
  readonly demonstrativePriceItems?: number;
}

export interface SummaryRowView { readonly ok: boolean; readonly label: string; readonly detail?: string }

export const ESTIMATE_UNAVAILABLE_TEXT = "Valor estimado indisponível — nenhum item possui preço de referência válido";
export const ESTIMATE_NO_QUANTITY_TEXT = "Valor estimado indisponível — nenhum item com preço de referência tem quantidade informada";

/**
 * Cotações: sem fictícia, o texto de sempre; com fictícia, separa-as das demais importadas. O "ok" exige que alguma cotação
 * NÃO fictícia exista E que algum item tenha de fato preço de referência (item com fictícia fica todo suspenso).
 */
export function quoteRowView(s: SourcesPriceSummary): SummaryRowView {
  const fictitious = Math.max(0, s.fictitiousQuoteCount ?? 0);
  if (fictitious === 0) return { ok: s.quoteCount > 0, label: `Baseado em ${s.quoteCount} cotação(ões) importada(s) com preço` };
  const real = s.quoteCount - fictitious;
  return { ok: real > 0 && s.pricedItems > 0 && (s.demonstrativePriceItems ?? 0) === 0, label: quoteCountText(s.quoteCount, fictitious) };
}

/** Motivo dos itens sem preço de referência (fictícia × outra suspensão × simplesmente sem preço). */
function unpricedDetail(s: SourcesPriceSummary): string | undefined {
  if (s.unpricedItems <= 0) return undefined;
  const fictitious = Math.max(0, s.fictitiousPriceItems ?? 0);
  const otherSuspended = Math.max(0, (s.priceSuspendedItems ?? 0) - fictitious);
  const parts = [`${s.unpricedItems} item(ns) sem preço de referência`];
  if (fictitious > 0) parts.push(`${fictitious} com preço suspenso por cotação fictícia (não constitui pesquisa de preços oficial)`);
  if (otherSuspended > 0) parts.push(`${otherSuspended} com preço suspenso (fonte alterada ou unidade divergente)`);
  return parts.join("; ");
}

function quantityDetail(s: SourcesPriceSummary): string | undefined {
  const n = Math.max(0, s.unknownQuantityItems ?? 0);
  return n > 0 ? `${n} item(ns) sem quantidade informada (fora do total)` : undefined;
}

function demonstrativeDetail(s: SourcesPriceSummary): string | undefined {
  const n = Math.max(0, s.demonstrativePriceItems ?? 0);
  return n > 0 ? `inclui valor demonstrativo de ${n} item(ns) (cotação fictícia admitida só em homologação sintética) — não é pesquisa de preços oficial` : undefined;
}

/**
 * Valor estimado global. Só há valor quando ao menos um item tem preço de referência válido; senão é INDISPONÍVEL — a
 * ausência nunca vira "R$ 0,00". O rótulo de total parcial é o mesmo dos documentos (`globalEstimateLabel`).
 */
export function estimateRowView(s: SourcesPriceSummary): SummaryRowView {
  const detail = [unpricedDetail(s), quantityDetail(s), demonstrativeDetail(s)].filter(Boolean).join("; ") || undefined;
  const unknownQty = Math.max(0, s.unknownQuantityItems ?? 0);
  if (s.pricedItems <= 0) return { ok: false, label: ESTIMATE_UNAVAILABLE_TEXT, ...(detail ? { detail } : {}) };
  // Itens com preço, mas nenhum com quantidade: o total 0 é ausência de base de cálculo, não um valor.
  if (s.estimatedGlobalTotalCents <= 0 && unknownQty > 0) return { ok: false, label: ESTIMATE_NO_QUANTITY_TEXT, ...(detail ? { detail } : {}) };
  // Item com preço, mas sem quantidade, também fica fora do total ⇒ o total é PARCIAL (nunca rotulado como global).
  const label = s.unpricedItems === 0 && unknownQty > 0
    ? `Valor estimado global PARCIAL (${unknownQty} de ${Math.max(unknownQty, s.approvedItems)} item(ns) sem quantidade informada não entram no total)`
    : globalEstimateLabel({ unpricedItemCount: s.unpricedItems, itemCount: s.approvedItems });
  return {
    ok: s.unpricedItems === 0 && unknownQty === 0 && (s.demonstrativePriceItems ?? 0) === 0,
    label: `${label}: ${formatCentsBRL(s.estimatedGlobalTotalCents)}`,
    ...(detail ? { detail } : {}),
  };
}

/**
 * "As fontes mudaram": com documento emitido/aprovado, regenerar é recusado pelo servidor — a tela não pode sugerir
 * "decida se deve gerar uma nova versão". Explica o estado real e aponta para o aviso de bloqueio (mesma fonte: `regenerationBlock`).
 */
export function sourceChangedNoticeText(kind: "etp" | "tr", block: RegenerationBlock | "loading"): string {
  const doc = kind.toUpperCase();
  // Bloqueio ainda desconhecido (rascunho carregando): só o fato, sem orientar a regenerar nem a não regenerar.
  if (block === "loading") return `As fontes do processo mudaram desde a última geração deste ${doc}.`;
  if (!block) return `As fontes do processo mudaram desde a última geração deste ${doc}. Revise as alterações e decida se deve gerar uma nova versão.`;
  const state = block.reason === "official_emitted"
    ? `já tem versão oficial emitida (v${block.officialVersion}), que continua válida`
    : "está aprovado";
  return `As fontes do processo mudaram desde a última geração deste ${doc}. Como o ${doc} ${state}, ele não pode ser gerado novamente; `
    + "veja abaixo o que continua possível.";
}
