import { useState, useEffect } from "react";

interface CitationData {
  id: string;
  citationText: string;
  sourceDocument: string;
  page: string | null;
  similarity: number;
  citationType: string;
  valid: boolean;
}

const mockCitations: CitationData[] = [
  { id: "c1", citationText: "O estudo técnico preliminar deverá evidenciar o problema a ser resolvido.", sourceDocument: "Lei 14.133/2021", page: null, similarity: 0.95, citationType: "legal_reference", valid: true },
  { id: "c2", citationText: "A especificação técnica deve ser detalhada e objetiva.", sourceDocument: "TR-2024-0042", page: "3", similarity: 0.82, citationType: "direct_quote", valid: true },
  { id: "c3", citationText: "Recomenda-se pesquisa ampla de mercado para formação de preço.", sourceDocument: "Acórdão TCU 1234/2023", page: null, similarity: 0.73, citationType: "paraphrase", valid: true },
];

const typeLabels: Record<string, string> = {
  direct_quote: "Citação Direta",
  paraphrase: "Paráfrase",
  legal_reference: "Ref. Legal",
  data_reference: "Ref. Dados",
  cross_reference: "Ref. Cruzada",
};

const typeColors: Record<string, string> = {
  direct_quote: "bg-blue-100 text-blue-800",
  paraphrase: "bg-green-100 text-green-800",
  legal_reference: "bg-amber-100 text-amber-800",
  data_reference: "bg-purple-100 text-purple-800",
  cross_reference: "bg-gray-100 text-gray-800",
};

export default function CitationViewer() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/4" />
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Citações</h2>
      <div className="space-y-3">
        {mockCitations.map((c, i) => (
          <div key={c.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-mono text-gray-400">[{i + 1}]</span>
              <div className="flex gap-1">
                <span className={`px-2 py-0.5 rounded text-xs ${typeColors[c.citationType] ?? ""}`}>
                  {typeLabels[c.citationType] ?? c.citationType}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs ${c.valid ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                  {c.valid ? "Válida" : "Inválida"}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-800 italic mb-2">"{c.citationText}"</p>
            <div className="flex justify-between items-center text-xs text-gray-500">
              <span>{c.sourceDocument}{c.page ? `, p. ${c.page}` : ""}</span>
              <span>Similaridade: {(c.similarity * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
