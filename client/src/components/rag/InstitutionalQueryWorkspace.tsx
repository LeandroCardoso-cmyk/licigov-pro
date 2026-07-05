import { useState, useEffect } from "react";

interface QueryResult {
  id: string;
  query: string;
  intent: string;
  queryType: string;
  contextStrategy: string;
  retrievalStrategy: string;
  createdAt: string;
}

const INTENTS = ["legal_consultation", "tr_generation", "item_search", "jurisprudence", "compliance_check", "document_review", "general"];

export default function InstitutionalQueryWorkspace() {
  const [loading, setLoading] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [queries, setQueries] = useState<QueryResult[]>([]);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded w-full" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    );
  }

  const handleSubmit = () => {
    if (!queryText.trim()) return;
    const newQuery: QueryResult = {
      id: `iq_${Date.now()}`,
      query: queryText,
      intent: INTENTS[Math.floor(queryText.length % INTENTS.length)],
      queryType: "factual",
      contextStrategy: "selective",
      retrievalStrategy: "hybrid",
      createdAt: new Date().toISOString(),
    };
    setQueries([newQuery, ...queries]);
    setQueryText("");
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Consulta Institucional</h2>
      <div className="space-y-3">
        <textarea
          className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          rows={4}
          placeholder="Digite sua consulta institucional..."
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
        />
        <button
          onClick={handleSubmit}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Enviar Consulta
        </button>
      </div>
      {queries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Consultas Recentes</h3>
          {queries.map((q) => (
            <div key={q.id} className="border border-gray-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-gray-900">{q.query}</p>
              <div className="flex gap-2 flex-wrap">
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{q.intent}</span>
                <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">{q.queryType}</span>
                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">{q.contextStrategy}</span>
                <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded text-xs">{q.retrievalStrategy}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
