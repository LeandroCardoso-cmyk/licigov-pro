import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ItemIntelligenceWorkspace — REAL (wired to tRPC). *** NÚCLEO DO DOMÍNIO ***
 *
 * UX: esta é a tela central da experiência. O trabalho NÃO é preencher itens —
 * é VALIDAR (aprovar/rejeitar) os Itens Inteligentes que o servidor já
 * enriqueceu com CATMAT sugerido, preço médio e recomendações. O servidor
 * sempre decide o CATMAT; o operador valida.
 */

const ITEM_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

const ITEM_STATUS_CLASSES: Record<string, string> = {
  pendente: "bg-gray-100 text-gray-700",
  em_analise: "bg-blue-100 text-blue-700",
  aprovado: "bg-green-100 text-green-700",
  rejeitado: "bg-red-100 text-red-700",
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

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
  const { data, isLoading } = trpc.procurementProcess.listItems.useQuery(
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

  const items = data?.items ?? [];

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">
          Itens Inteligentes
        </h1>
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
          Núcleo
        </span>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Valide as recomendações do sistema. O servidor decide o CATMAT; você
        aprova ou rejeita cada item.
      </p>

      {!processId ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Selecione um processo para ver seus itens.
        </div>
      ) : isLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhum item inteligente. Importe uma pesquisa de preços primeiro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Qtd.</th>
                <th className="px-4 py-3">Un.</th>
                <th className="px-4 py-3">Preço médio</th>
                <th className="px-4 py-3">CATMAT sugerido</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpenItem?.(it.id)}
                      className="text-left font-medium text-blue-700 hover:underline"
                    >
                      {it.description}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{it.quantity}</td>
                  <td className="px-4 py-3 text-gray-700">{it.unit}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {brl(it.averagePrice)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                      {it.suggestedCATMAT ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        ITEM_STATUS_CLASSES[it.status] ??
                        "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {ITEM_STATUS_LABELS[it.status] ?? it.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => approveItem.mutate({ itemId: it.id })}
                        disabled={approveItem.isPending}
                        className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectItem.mutate({ itemId: it.id })}
                        disabled={rejectItem.isPending}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Rejeitar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
