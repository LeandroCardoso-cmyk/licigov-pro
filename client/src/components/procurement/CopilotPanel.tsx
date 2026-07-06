import React from "react";

/**
 * CopilotPanel — PRESENTATIONAL.
 *
 * UX: mostra os copilotos do domínio coordenados pelo Multi-Copilot Orchestrator.
 * Reforça que a experiência é de REVISÃO: os copilotos produzem recomendações;
 * o operador valida. Nenhum copiloto age sem rastreabilidade.
 */

const COPILOT_META: Record<string, { label: string; description: string }> = {
  planejamento: {
    label: "Copiloto de Planejamento",
    description: "DFD, ETP e estruturação da demanda.",
  },
  tr_intelligence: {
    label: "TR Intelligence",
    description: "Termo de Referência, itens e especificações.",
  },
  pesquisa_precos: {
    label: "Copiloto de Pesquisa de Preços",
    description: "Extração de cotações e preço médio.",
  },
  juridico: {
    label: "Copiloto Jurídico",
    description: "Conformidade com a Lei 14.133/2021.",
  },
  agente_contratacao: {
    label: "Agente de Contratação",
    description: "Edital, modalidade e emissão.",
  },
};

const DEFAULT_COPILOTS = [
  "planejamento",
  "tr_intelligence",
  "pesquisa_precos",
  "juridico",
  "agente_contratacao",
];

export type CopilotPanelProps = {
  copilots?: string[];
};

export default function CopilotPanel({
  copilots = DEFAULT_COPILOTS,
}: CopilotPanelProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold text-gray-900">Copilotos ativos</h2>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
          Multi-Copilot Orchestrator
        </span>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Coordenados pelo orquestrador. Produzem recomendações; a decisão final é
        sempre humana.
      </p>
      <ul className="space-y-3">
        {copilots.map((c) => {
          const meta = COPILOT_META[c];
          return (
            <li key={c} className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-green-500" />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {meta?.label ?? c}
                </p>
                {meta && (
                  <p className="text-xs text-gray-500">{meta.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
