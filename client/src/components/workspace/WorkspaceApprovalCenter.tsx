import React, { useState } from "react";

export interface PendingApprovalItem {
  id: string;
  title: string;
  kind: string;
}

interface WorkspaceApprovalCenterProps {
  pendingItems?: PendingApprovalItem[];
}

const DEFAULT_ITEMS: PendingApprovalItem[] = [
  { id: "a1", title: "Aprovação do DFD", kind: "documento" },
  { id: "a2", title: "Decisão sobre modalidade", kind: "decisao" },
  { id: "a3", title: "Validação da pesquisa de preços", kind: "tarefa" },
];

type ItemState = "pending" | "approved" | "rejected";

const STATE_STYLES: Record<ItemState, string> = {
  pending: "bg-orange-100 text-orange-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const STATE_LABELS: Record<ItemState, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
};

export default function WorkspaceApprovalCenter({
  pendingItems = DEFAULT_ITEMS,
}: WorkspaceApprovalCenterProps) {
  const [states, setStates] = useState<Record<string, ItemState>>({});

  const setItemState = (id: string, next: ItemState) => {
    setStates((prev) => ({ ...prev, [id]: next }));
  };

  const hasItems = pendingItems.length > 0;

  return (
    <div className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        Central de Aprovações
      </h2>
      <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
        Revisão humana obrigatória. Nenhuma ação é finalizada sem aprovação de um
        agente público responsável.
      </div>

      <ul className="space-y-3">
        {pendingItems.map((item) => {
          const state = states[item.id] ?? "pending";
          return (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}
                  >
                    {STATE_LABELS[state]}
                  </span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {item.kind}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {item.title}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setItemState(item.id, "approved")}
                  disabled={state !== "pending"}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  onClick={() => setItemState(item.id, "rejected")}
                  disabled={state !== "pending"}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                >
                  Rejeitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {!hasItems && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Nenhum item aguardando aprovação.
        </div>
      )}
    </div>
  );
}
