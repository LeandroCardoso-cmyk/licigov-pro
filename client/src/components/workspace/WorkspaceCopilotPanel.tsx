import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

interface WorkspaceCopilotPanelProps {
  workspaceId?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  baixo: "bg-green-100 text-green-700",
  medio: "bg-yellow-100 text-yellow-700",
  alto: "bg-orange-100 text-orange-700",
  critico: "bg-red-100 text-red-700",
};

export default function WorkspaceCopilotPanel({
  workspaceId = "",
}: WorkspaceCopilotPanelProps) {
  const [request, setRequest] = useState("");
  const orchestrate = trpc.workspace.orchestrate.useMutation();

  const enabled = workspaceId.trim().length > 0;

  const handleSubmit = () => {
    if (!enabled || request.trim().length === 0) return;
    orchestrate.mutate({ workspaceId, request });
  };

  const result = orchestrate.data;
  const consolidated = result?.consolidated;

  return (
    <div className="p-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        Painel de Copilotos
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Orquestre múltiplos copilotos especializados para apoiar a contratação.
      </p>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Descreva sua solicitação aos copilotos..."
          rows={3}
          className="flex-1 rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!enabled || orchestrate.isPending || request.trim().length === 0}
          className="h-fit rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {orchestrate.isPending ? "Consultando..." : "Orquestrar"}
        </button>
      </div>

      {!enabled && (
        <p className="text-sm text-gray-500">
          Selecione um espaço de trabalho para usar os copilotos.
        </p>
      )}

      {orchestrate.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Falha ao consultar os copilotos.
        </div>
      )}

      {consolidated && (
        <div className="space-y-4">
          {consolidated.requiresHumanReview && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
              <strong>Revisão humana obrigatória.</strong> Toda saída de IA deve
              ser editável, revisável e validada por um humano.
            </div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Recomendação Consolidada
            </h3>
            <p className="text-sm text-gray-700">{consolidated.summary}</p>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                <span>Confiança</span>
                <span>{Math.round(consolidated.confidence * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, consolidated.confidence * 100))}%`,
                  }}
                />
              </div>
            </div>

            {consolidated.suggestions.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase text-gray-400">
                  Sugestões
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {consolidated.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {consolidated.risks.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase text-gray-400">
                  Riscos Identificados
                </p>
                <ul className="space-y-2">
                  {consolidated.risks.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-gray-100 bg-gray-50 p-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[r.severity] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {r.severity}
                        </span>
                        <span className="text-gray-800">{r.description}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Mitigação: {r.mitigation}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {consolidated.participatingCopilots.map((c) => (
                <span
                  key={c}
                  className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {result && result.conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-sm font-semibold text-amber-800">
                Conflitos entre copilotos
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700">
                {result.conflicts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
