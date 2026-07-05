import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

// Sprint 4.8.1 — consome dados reais do grafo via tRPC (knowledgeGraph.searchNode).
// A busca dispara a query quando há termo; sem termo, mostra estado inicial.

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  legislation: { bg: "bg-red-50", border: "border-red-400", text: "text-red-700" },
  article: { bg: "bg-red-50", border: "border-red-300", text: "text-red-600" },
  clause: { bg: "bg-amber-50", border: "border-amber-400", text: "text-amber-700" },
  jurisprudence: { bg: "bg-purple-50", border: "border-purple-400", text: "text-purple-700" },
  process: { bg: "bg-blue-50", border: "border-blue-400", text: "text-blue-700" },
  contract: { bg: "bg-indigo-50", border: "border-indigo-400", text: "text-indigo-700" },
  technical_requirement: { bg: "bg-green-50", border: "border-green-400", text: "text-green-700" },
  supplier: { bg: "bg-teal-50", border: "border-teal-400", text: "text-teal-700" },
  risk: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-700" },
  concept: { bg: "bg-gray-50", border: "border-gray-400", text: "text-gray-700" },
};

function colorFor(nodeType: string) {
  return NODE_COLORS[nodeType] ?? { bg: "bg-gray-50", border: "border-gray-300", text: "text-gray-700" };
}

export default function KnowledgeGraphViewer() {
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data, isLoading, isFetching } = trpc.knowledgeGraph.searchNode.useQuery(
    { query: submitted, limit: 50 },
    { enabled: submitted.length > 0 },
  );

  const results = data?.results ?? [];

  return (
    <div className="p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-800">Grafo de Conhecimento</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(term.trim());
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar nós no grafo (ex.: Lei 14.133, pregão, cláusula...)"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={term.trim().length === 0}
        >
          Buscar
        </button>
      </form>

      {submitted.length === 0 && (
        <p className="text-sm text-gray-400 italic">
          Digite um termo e busque para explorar os nós persistidos do grafo desta organização.
        </p>
      )}

      {submitted.length > 0 && (isLoading || isFetching) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      )}

      {submitted.length > 0 && !isLoading && !isFetching && results.length === 0 && (
        <p className="text-sm text-gray-400 italic">Nenhum nó encontrado para "{submitted}".</p>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {results.map((node) => {
            const c = colorFor(node.nodeType);
            return (
              <div
                key={node.id}
                className={`rounded-lg border-2 p-4 ${c.bg} ${c.border} transition-shadow hover:shadow-md`}
              >
                <span className={`text-xs font-semibold uppercase tracking-wide ${c.text}`}>
                  {node.nodeType}
                </span>
                <p className="mt-1 text-sm font-medium text-gray-900">{node.title}</p>
                {node.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{node.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
