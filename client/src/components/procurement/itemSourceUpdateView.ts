/**
 * R9 / SEM-052 · SEM-054 — helpers PUROS (testáveis sem DOM) da confirmação "Aplicar cotações atualizadas"
 * e do portão de aprovação dos Itens Inteligentes.
 *
 * Unidades: TODOS os valores monetários chegam do servidor em CENTAVOS inteiros (prévia, média do item,
 * outliers) e são formatados só com `formatCentsBRL`. O cálculo é sempre do servidor.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { formatCentsBRL } from "@/lib/money";
import { itemApprovalBlock, type ItemApprovalBlock, type PriceOutlier } from "@shared/itemApprovalGate";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type SourceUpdatePreview = RouterOutputs["procurementProcess"]["previewItemSourceUpdate"];

export const ITEM_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

const statusLabel = (s: string): string => ITEM_STATUS_LABELS[s] ?? s;
const money = (cents: number | null): string => (cents === null ? "sem preço" : formatCentsBRL(cents));
const signedMoney = (cents: number): string => (cents > 0 ? `+${formatCentsBRL(cents)}` : formatCentsBRL(cents));

export interface SourceUpdateConfirmModel {
  readonly title: string;
  readonly rows: ReadonlyArray<{ label: string; before: string; after: string }>;
  readonly averageDelta: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /** A decisão humana será revogada ao aplicar? */
  readonly revokes: boolean;
  /** Frase explícita sobre a decisão humana (revogação ou status mantido). */
  readonly decisionNotice: string;
}

/** Modelo de exibição do comparativo atual × proposto (por item) mostrado ANTES de aplicar. */
export function sourceUpdateConfirmModel(p: SourceUpdatePreview): SourceUpdateConfirmModel {
  const revokes = p.revokesDecision !== null;
  const decisionNotice = p.revokesDecision === "aprovado"
    ? `A aprovação humana deste item será REVOGADA: o item volta para "${statusLabel(p.statusAfter)}" e precisará ser aprovado novamente com os novos números.`
    : p.revokesDecision === "rejeitado"
      ? `A rejeição registrada deste item será REVOGADA: o item volta para "${statusLabel(p.statusAfter)}" e precisará de nova decisão.`
      : `O item permanece em "${statusLabel(p.statusAfter)}"; nenhuma decisão humana é revogada.`;
  return {
    title: `Comparativo de cotações — ${p.description}`,
    rows: [
      { label: "Cotações válidas", before: String(p.current.quoteCount), after: String(p.proposed.quoteCount) },
      { label: "Preço médio (referência)", before: formatCentsBRL(p.current.averageCents), after: formatCentsBRL(p.proposed.averageCents) },
      { label: "Situação do item", before: statusLabel(p.status), after: statusLabel(p.statusAfter) },
    ],
    averageDelta: signedMoney(p.averageDeltaCents),
    added: p.added.map((q) => `${q.supplier || "Fornecedor não identificado"} — ${money(q.valueCents)}`),
    removed: p.removed.map((q) => `${q.supplier || "Fornecedor não identificado"} — ${money(q.valueCents)}`),
    changed: p.changed.map((q) => `${q.supplier || "Fornecedor não identificado"}: ${money(q.beforeCents)} → ${money(q.afterCents)}`),
    revokes,
    decisionNotice,
  };
}

/** Entrada da mutação: SEMPRE o token da prévia exibida (o servidor recusa estado diferente). */
export function applyInputFromPreview(p: Pick<SourceUpdatePreview, "itemId" | "expectedStateToken">): { itemId: string; expectedStateToken: string } {
  return { itemId: p.itemId, expectedStateToken: p.expectedStateToken };
}

/** CONFLICT do servidor = a confirmação ficou desatualizada (nada foi aplicado). */
export function isStaleConfirmationError(err: { data?: { code?: string } | null; message?: string } | null | undefined): boolean {
  return !!err && (err.data?.code === "CONFLICT" || /SOURCE_UPDATE_STALE/.test(err.message ?? ""));
}

export interface ApproveButtonState {
  readonly disabled: boolean;
  readonly block: ItemApprovalBlock | null;
}

/** Estado do botão "Aprovar": bloqueado (com motivo) quando a fonte não está vigente — mesma regra do servidor. */
export function approveButtonState(sourceState: string | null | undefined, isPending: boolean): ApproveButtonState {
  const block = itemApprovalBlock(sourceState);
  return { disabled: isPending || block !== null, block };
}

/** Texto curto das cotações fora da curva (valores em CENTAVOS). */
export function outlierSummary(outliers: readonly PriceOutlier[] | null | undefined): string[] {
  return (outliers ?? []).map((o) => `${o.name || "Fornecedor não identificado"} — ${formatCentsBRL(o.valueCents)} (${o.deviationPercent > 0 ? "+" : ""}${o.deviationPercent}% da média)`);
}
