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

export default function CopilotMetricsDashboard() {
  const metrics = trpc.copilot.getMetrics.useQuery();

  const entries = Object.entries(metrics.data?.byCopilot ?? {});

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Indicadores dos Copilotos</h2>

      {metrics.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
            <p className="text-sm font-medium text-indigo-600">Total de Sessões</p>
            <p className="mt-1 text-4xl font-bold text-indigo-900">
              {metrics.data?.totalSessions ?? 0}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma sessão registrada.</p>
            ) : (
              entries.map(([type, count]) => {
                const meta = metaFor(type);
                return (
                  <div key={type} className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{meta.emoji}</span>
                      <span className="text-2xl font-bold text-gray-900">{count}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-700">{meta.label}</p>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {metrics.isError && (
        <p className="text-sm text-red-600">Erro ao carregar indicadores.</p>
      )}
    </div>
  );
}
