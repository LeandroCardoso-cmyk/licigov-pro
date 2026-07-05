import React from "react";
import { trpc } from "../../lib/trpc";

const STATUS_BADGE: Record<string, string> = {
  open: "bg-gray-100 text-gray-700",
  reasoning: "bg-blue-100 text-blue-700",
  recommended: "bg-indigo-100 text-indigo-700",
  awaiting_approval: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  closed: "bg-gray-100 text-gray-700",
};

interface WorkspaceResult {
  summary: string;
  confidence: number;
  status: string;
  reviewNotice: string;
  requiresHumanReview: boolean;
}

export default function CopilotWorkspace() {
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<WorkspaceResult | null>(null);
  const [error, setError] = React.useState<string>("");

  const createSession = trpc.copilot.createSession.useMutation();
  const executeCopilot = trpc.copilot.executeCopilot.useMutation();

  const isBusy = createSession.isPending || executeCopilot.isPending;

  const handleRun = async () => {
    if (!query.trim()) return;
    setError("");
    setResult(null);
    try {
      const created = await createSession.mutateAsync({ query: query.trim() });
      const executed = await executeCopilot.mutateAsync({ sessionId: created.session.id });
      setResult({
        summary: executed.recommendation.summary,
        confidence: executed.recommendation.confidence,
        status: executed.status,
        reviewNotice: executed.recommendation.reviewNotice,
        requiresHumanReview: executed.recommendation.requiresHumanReview,
      });
    } catch {
      setError("Não foi possível executar o copiloto. Tente novamente.");
    }
  };

  const pct = result ? Math.round(Math.max(0, Math.min(1, result.confidence)) * 100) : 0;

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Espaço de Trabalho do Copiloto</h2>
        <p className="text-sm text-gray-500">
          Descreva a demanda e execute o pipeline cognitivo completo.
        </p>
      </div>

      <div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          placeholder="Ex.: Preciso estruturar a contratação de serviços de limpeza predial."
          className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={isBusy || query.trim() === ""}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {createSession.isPending
              ? "Criando sessão..."
              : executeCopilot.isPending
                ? "Executando..."
                : "Executar copiloto"}
          </button>
          {isBusy && <span className="text-xs text-gray-400">Processando pipeline...</span>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-4 rounded-md border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-gray-800">Recomendação gerada</h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_BADGE[result.status] ?? "bg-gray-100 text-gray-700"
              }`}
            >
              {result.status}
            </span>
          </div>

          <p className="text-sm text-gray-700">{result.summary}</p>

          <div>
            <p className="mb-1 flex justify-between text-xs font-medium text-gray-500">
              <span>Confiança</span>
              <span>{pct}%</span>
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {result.requiresHumanReview && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">⚠️ Revisão obrigatória</p>
              <p className="mt-1 text-xs text-amber-700">{result.reviewNotice}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
