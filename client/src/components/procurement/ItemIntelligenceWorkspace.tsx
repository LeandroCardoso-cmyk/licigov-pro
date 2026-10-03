import React from "react";
import { trpc } from "../../lib/trpc";
import { formatCentsBRL } from "@/lib/money";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import CatmatThresholdConfig from "./CatmatThresholdConfig";
import ItemSourceUpdateConfirm from "./ItemSourceUpdateConfirm";
import { ITEM_STATUS_LABELS, approveButtonState, outlierSummary } from "./itemSourceUpdateView";

/**
 * ItemIntelligenceWorkspace — REAL (wired to tRPC). *** NÚCLEO DO DOMÍNIO ***
 *
 * UX: esta é a tela central da experiência. O trabalho NÃO é preencher itens —
 * é VALIDAR (aprovar/rejeitar) os Itens Inteligentes que o servidor já
 * enriqueceu com CATMAT sugerido, preço médio e recomendações. O servidor
 * sugere a classificação; a confirmação humana ocorre no painel do item.
 */

const ITEM_STATUS_CLASSES: Record<string, string> = {
  pendente: "bg-muted text-foreground",
  em_analise: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  aprovado: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  rejeitado: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
};

export type ItemIntelligenceWorkspaceProps = {
  processId?: string;
  /** Abre o painel lateral de inteligência de um item específico. */
  onOpenItem?: (itemId: string) => void;
};

export default function ItemIntelligenceWorkspace({
  processId = "",
  onOpenItem,
}: ItemIntelligenceWorkspaceProps) {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, isFetching, refetch } = trpc.procurementProcess.listItems.useQuery(
    { processId },
    { enabled: !!processId },
  );

  const invalidate = () => {
    if (processId) utils.procurementProcess.listItems.invalidate({ processId });
  };
  const approveItem = trpc.procurementProcess.approveItem.useMutation({
    onSuccess: invalidate,
  });
  const rejectItem = trpc.procurementProcess.rejectItem.useMutation({
    onSuccess: invalidate,
  });
  // Hardening P0 — fonte alterada após decisão: aplicar as cotações novas é uma ação HUMANA explícita
  // (item decidido volta a "Em análise"); nunca acontece em silêncio.
  // R9 / SEM-052 — e nunca num clique: o botão só ABRE a confirmação (comparativo atual × proposto +
  // revogação declarada); a aplicação acontece em ItemSourceUpdateConfirm, com o token da prévia vista.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  const items = data?.items ?? [];

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Itens Inteligentes
        </h1>
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-primary-foreground">
          Núcleo
        </span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Revise as cotações e aprove ou rejeite cada item. A classificação CATMAT/CATSER é uma
        sugestão: abra o item para confirmá-la. Aprovar o item não confirma automaticamente o catálogo.
      </p>

      {(approveItem.error || rejectItem.error) && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {domainErrorMessage(approveItem.error?.message || rejectItem.error?.message, "Não foi possível registrar a decisão.")}
        </p>
      )}

      {processId && <CatmatThresholdConfig />}

      {!processId ? (
        <div className="rounded-xl border border-dashed border-input bg-card p-8 text-center text-muted-foreground">
          Selecione um processo para ver seus itens.
        </div>
      ) : isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted" />
          ))}
        </div>
      ) : isError && !data ? (
        // Primeira carga falhou (sem itens em cache): estado de erro completo.
        <div role="alert" className="rounded-xl border border-destructive/40 p-5 text-sm text-destructive">
          <p>Não foi possível carregar os itens deste processo.</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="mt-2 underline disabled:no-underline disabled:opacity-60">Tentar novamente</button>
        </div>
      ) : (
        <>
          {/* Refetch falhou com itens válidos em cache: aviso NÃO bloqueante; a tabela anterior permanece. */}
          {isError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
              <span>Não foi possível atualizar os dados agora. As informações abaixo são da última consulta bem-sucedida.</span>
              <button type="button" onClick={() => void refetch()} disabled={isFetching} className="underline disabled:no-underline disabled:opacity-60">Tentar novamente</button>
            </div>
          )}
          {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-input bg-card p-8 text-center text-muted-foreground">
          Nenhum item inteligente. Importe uma pesquisa de preços primeiro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Qtd.</th>
                <th className="px-4 py-3">Un.</th>
                <th className="px-4 py-3">Preço médio</th>
                <th className="px-4 py-3">CATMAT sugerido</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                // R9 / SEM-054 — mesma regra do servidor: fonte não vigente ⇒ "Aprovar" bloqueado com motivo.
                const approve = approveButtonState(it.sourceState, approveItem.isPending);
                const outliers = outlierSummary(it.priceOutliers);
                const confirming = confirmingId === it.id;
                return (
                  <React.Fragment key={it.id}>
                    <tr className="hover:bg-muted">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onOpenItem?.(it.id)}
                          className="text-left font-medium text-blue-700 dark:text-blue-300 hover:underline"
                        >
                          {it.description}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-foreground">{it.quantity}</td>
                      <td className="px-4 py-3 text-foreground">{it.unit}</td>
                      <td className="px-4 py-3 text-foreground">
                        {/* R9 / SEM-054 — média em CENTAVOS (servidor) = preço que vira a referência canônica ao aprovar. */}
                        <span className="font-mono">{formatCentsBRL(it.averagePriceCents)}</span>
                        {!approve.block && it.status !== "aprovado" && (
                          <div className="mt-1 text-xs text-muted-foreground">Referência canônica ao aprovar</div>
                        )}
                        {outliers.length > 0 && (
                          <div className="mt-1 text-xs text-orange-700 dark:text-orange-300">
                            <p className="font-medium">{outliers.length} cotação(ões) fora da curva (&gt;50% da média):</p>
                            <ul className="list-disc pl-4">
                              {outliers.map((o) => <li key={o}>{o}</li>)}
                            </ul>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">
                          {it.suggestedCATMAT ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            ITEM_STATUS_CLASSES[it.status] ??
                            "bg-muted text-foreground"
                          }`}
                        >
                          {ITEM_STATUS_LABELS[it.status] ?? it.status}
                        </span>
                        {it.sourceState === "source_changed" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300" title={it.sourceStateReason ?? undefined}>
                            Fonte alterada
                          </span>
                        )}
                        {it.sourceState === "review_required" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            Identidade a revisar
                          </span>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">{it.quoteCount} cotação(ões) válida(s)</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {it.sourceState === "source_changed" && (
                            <button
                              type="button"
                              onClick={() => setConfirmingId(confirming ? null : it.id)}
                              aria-expanded={confirming}
                              aria-controls={`source-update-${it.id}`}
                              className="rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                            >
                              Aplicar cotações atualizadas{it.pendingQuoteCount != null ? ` (${it.pendingQuoteCount})` : ""}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => approveItem.mutate({ itemId: it.id })}
                            disabled={approve.disabled}
                            title={approve.block?.reason}
                            className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-green-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectItem.mutate({ itemId: it.id })}
                            disabled={rejectItem.isPending}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-destructive hover:bg-red-50 dark:hover:bg-red-950 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                          >
                            Rejeitar
                          </button>
                        </div>
                        {approve.block && (
                          <p className="mt-1 max-w-xs text-right text-xs text-amber-800 dark:text-amber-300" data-testid="approve-blocked-reason">
                            Aprovação bloqueada: {approve.block.reason}
                          </p>
                        )}
                      </td>
                    </tr>
                    {confirming && (
                      <tr id={`source-update-${it.id}`}>
                        <td colSpan={7} className="px-4 pb-4">
                          <ItemSourceUpdateConfirm itemId={it.id} onClose={() => setConfirmingId(null)} onApplied={invalidate} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}
    </div>
  );
}
