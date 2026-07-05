import React from "react";
import { trpc } from "../../lib/trpc";

const COPILOT_META: Record<string, { label: string; emoji: string }> = {
  agente_contratacao: { label: "Agente de Contratação", emoji: "📋" },
  pregoeiro: { label: "Pregoeiro", emoji: "🎯" },
  planejamento: { label: "Planejamento", emoji: "🗺️" },
  tr_intelligence: { label: "TR Intelligence", emoji: "📑" },
  juridico: { label: "Jurídico", emoji: "⚖️" },
  pesquisa_precos: { label: "Pesquisa de Preços", emoji: "💰" },
  contratos: { label: "Contratos", emoji: "📝" },
  controle_interno: { label: "Controle Interno", emoji: "🛡️" },
};

function metaFor(type: string): { label: string; emoji: string } {
  return COPILOT_META[type] ?? { label: type, emoji: "🤖" };
}

export default function CopilotComparisonPanel() {
  const [query, setQuery] = React.useState("");
  const compare = trpc.copilot.compareRecommendations.useMutation();

  const comparisons = compare.data?.comparisons ?? [];

  const handleCompare = () => {
    if (query.trim()) {
      compare.mutate({ query: query.trim() });
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-900">Comparar Recomendações</h2>

      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCompare();
          }}
          placeholder="Descreva a situação a analisar..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCompare}
          disabled={compare.isPending || query.trim() === ""}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {compare.isPending ? "Comparando..." : "Comparar"}
        </button>
      </div>

      {compare.isError && (
        <p className="text-sm text-red-600">Erro ao comparar recomendações.</p>
      )}

      {compare.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : comparisons.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {comparisons.map((c) => {
            const meta = metaFor(c.copilotType);
            const pct = Math.round(Math.max(0, Math.min(1, c.confidence)) * 100);
            return (
              <div key={c.copilotType} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-2xl">{meta.emoji}</span>
                  <span className="text-sm font-semibold text-gray-900">{meta.label}</span>
                </div>
                <div className="mb-3">
                  <p className="mb-1 flex justify-between text-xs font-medium text-gray-500">
                    <span>Confiança</span>
                    <span>{pct}%</span>
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <p className="text-sm text-gray-700">{c.summary}</p>
                <p className="mt-3 text-xs font-medium text-gray-500">
                  {c.riskCount} risco(s) identificado(s)
                  {c.groundingOnly ? " · somente evidências" : ""}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        !compare.isPending && (
          <p className="text-sm text-gray-400">
            Informe uma consulta e clique em Comparar para ver as recomendações lado a lado.
          </p>
        )
      )}
    </div>
  );
}
