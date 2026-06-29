import { useState, useEffect } from "react";

interface LegalRef {
  id: string;
  lawReference: string;
  article: string;
  clause: string | null;
  text: string;
  confidence: number;
  sourceType: string;
}

const mockRefs: LegalRef[] = [
  { id: "le1", lawReference: "Lei 14.133/2021", article: "Art. 18", clause: null, text: "O estudo técnico preliminar deverá evidenciar o problema a ser resolvido e a melhor solução.", confidence: 0.95, sourceType: "lei_14133" },
  { id: "le2", lawReference: "Lei 14.133/2021", article: "Art. 6º, XXIII", clause: null, text: "Termo de referência: documento necessário para a contratação de bens e serviços.", confidence: 0.92, sourceType: "lei_14133" },
  { id: "le3", lawReference: "Decreto 11.462/2023", article: "Art. 3º", clause: "§ 1º", text: "A pesquisa de preços será realizada mediante critérios de ampla divulgação.", confidence: 0.85, sourceType: "decreto" },
];

export default function LegalEvidencePanel() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-32 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-200 rounded" />
      </div>
    );
  }

  const grouped = new Map<string, LegalRef[]>();
  for (const ref of mockRefs) {
    const existing = grouped.get(ref.lawReference) ?? [];
    existing.push(ref);
    grouped.set(ref.lawReference, existing);
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Evidências Jurídicas</h2>
      {Array.from(grouped.entries()).map(([law, refs]) => (
        <div key={law} className="border border-amber-200 rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-4 py-2 border-b border-amber-200">
            <h3 className="text-sm font-semibold text-amber-900">{law}</h3>
          </div>
          <div className="divide-y divide-amber-100">
            {refs.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-gray-900">{r.article}{r.clause ? `, ${r.clause}` : ""}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${r.confidence > 0.9 ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                    {(r.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-gray-600">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
