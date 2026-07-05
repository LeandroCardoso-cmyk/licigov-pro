import React from "react";

export interface CopilotOption {
  type: string;
  label: string;
  domain: string;
  emoji: string;
}

export const DEFAULT_COPILOTS: CopilotOption[] = [
  { type: "agente_contratacao", label: "Agente de Contratação", domain: "Contratação", emoji: "📋" },
  { type: "pregoeiro", label: "Pregoeiro", domain: "Pregão", emoji: "🎯" },
  { type: "planejamento", label: "Planejamento", domain: "Planejamento", emoji: "🗺️" },
  { type: "tr_intelligence", label: "TR Intelligence", domain: "Termo de Referência", emoji: "📑" },
  { type: "juridico", label: "Jurídico", domain: "Jurídico-administrativo", emoji: "⚖️" },
  { type: "pesquisa_precos", label: "Pesquisa de Preços", domain: "Pesquisa de Preços", emoji: "💰" },
  { type: "contratos", label: "Contratos", domain: "Contratos e Aditivos", emoji: "📝" },
  { type: "controle_interno", label: "Controle Interno", domain: "Controle Interno", emoji: "🛡️" },
];

interface CopilotSelectorProps {
  copilots?: CopilotOption[];
  selectedType?: string;
  onSelect?: (type: string) => void;
}

export default function CopilotSelector({
  copilots = DEFAULT_COPILOTS,
  selectedType = "",
  onSelect = () => {},
}: CopilotSelectorProps) {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Escolha um copiloto</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {copilots.map((c) => {
          const selected = c.type === selectedType;
          return (
            <button
              key={c.type}
              type="button"
              onClick={() => onSelect(c.type)}
              className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition ${
                selected
                  ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200"
                  : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
              }`}
            >
              <span className="text-3xl">{c.emoji}</span>
              <span className="text-sm font-semibold text-gray-900">{c.label}</span>
              <span className="text-xs text-gray-500">{c.domain}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
