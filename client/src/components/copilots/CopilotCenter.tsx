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

const STATUS_BADGE: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  reasoning: "bg-blue-100 text-blue-700",
  recommended: "bg-indigo-100 text-indigo-700",
  awaiting_approval: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  closed: "bg-gray-100 text-gray-700",
};

function metaFor(type: string): { label: string; emoji: string } {
  return COPILOT_META[type] ?? { label: type, emoji: "🤖" };
}

export default function CopilotCenter() {
  const metrics = trpc.copilot.getMetrics.useQuery();
  const history = trpc.copilot.getHistory.useQuery({ limit: 10 });

  const isLoading = metrics.isLoading || history.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Central de Copilotos Institucionais</h1>
        <p className="text-sm text-gray-500">
          Camada cognitiva operacional do departamento de licitações.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Total de Sessões</p>
          {metrics.isLoading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded bg-gray-200" />
          ) : (
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {metrics.data?.totalSessions ?? 0}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Distribuição por Copiloto</h2>
        {metrics.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-6 w-full animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(metrics.data?.byCopilot ?? {}).map(([type, count]) => {
              const meta = metaFor(type);
              return (
                <div key={type} className="flex items-center gap-3 rounded-md bg-gray-50 p-3">
                  <span className="text-2xl">{meta.emoji}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{meta.label}</p>
                    <p className="text-xs text-gray-500">{count} sessões</p>
                  </div>
                </div>
              );
            })}
            {Object.keys(metrics.data?.byCopilot ?? {}).length === 0 && (
              <p className="text-sm text-gray-400">Nenhuma sessão registrada.</p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Sessões Recentes</h2>
        {history.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : history.data && history.data.sessions.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {history.data.sessions.map((s) => {
              const meta = metaFor(s.copilotType);
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-xl">{meta.emoji}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800">{s.query}</p>
                      <p className="text-xs text-gray-500">{meta.label}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGE[s.status] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {s.status}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Nenhuma sessão recente.</p>
        )}
      </div>

      {!isLoading && metrics.isError && (
        <p className="text-sm text-red-600">Erro ao carregar métricas dos copilotos.</p>
      )}
    </div>
  );
}
