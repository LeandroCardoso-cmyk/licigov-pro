import React from "react";

export interface WorkspaceDecision {
  id: string;
  title: string;
  outcome: string;
  status: string;
  responsibleUser: string;
}

interface WorkspaceDecisionPanelProps {
  decisions?: WorkspaceDecision[];
}

const DEFAULT_DECISIONS: WorkspaceDecision[] = [
  {
    id: "d1",
    title: "Escolha da modalidade de licitação",
    outcome: "Pregão eletrônico",
    status: "aprovada",
    responsibleUser: "Ana Souza",
  },
  {
    id: "d2",
    title: "Definição do critério de julgamento",
    outcome: "Menor preço",
    status: "pendente",
    responsibleUser: "Carlos Lima",
  },
  {
    id: "d3",
    title: "Aprovação do Termo de Referência",
    outcome: "Aguardando revisão jurídica",
    status: "em_revisao",
    responsibleUser: "Marina Alves",
  },
];

const STATUS_STYLES: Record<string, string> = {
  aprovada: "bg-green-100 text-green-700",
  pendente: "bg-gray-100 text-gray-700",
  em_revisao: "bg-amber-100 text-amber-700",
  rejeitada: "bg-red-100 text-red-700",
};

export default function WorkspaceDecisionPanel({
  decisions = DEFAULT_DECISIONS,
}: WorkspaceDecisionPanelProps) {
  return (
    <div className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        Painel de Decisões
      </h2>
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
        Decisões são sempre humanas. Os copilotos apoiam, mas a deliberação
        final é de responsabilidade do agente público.
      </div>

      <ul className="space-y-3">
        {decisions.map((d) => (
          <li
            key={d.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{d.title}</h3>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {d.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-700">Resultado: {d.outcome}</p>
            <p className="mt-1 text-xs text-gray-500">
              Responsável: {d.responsibleUser}
            </p>
          </li>
        ))}
        {decisions.length === 0 && (
          <li className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            Nenhuma decisão registrada.
          </li>
        )}
      </ul>
    </div>
  );
}
