import React, { useState, useEffect } from "react";

type RelationType = "fundamenta" | "compoe" | "referencia" | "exige" | "complementa";

interface Relationship {
  id: string;
  nodeLabel: string;
  type: RelationType;
  weight: number;
  confidence: number;
}

interface RelationshipData {
  nodeLabel: string;
  incoming: Relationship[];
  outgoing: Relationship[];
}

const RELATION_STYLES: Record<RelationType, string> = {
  fundamenta: "bg-blue-100 text-blue-700",
  compoe: "bg-purple-100 text-purple-700",
  referencia: "bg-green-100 text-green-700",
  exige: "bg-red-100 text-red-700",
  complementa: "bg-amber-100 text-amber-700",
};

const MOCK_DATA: RelationshipData = {
  nodeLabel: "Termo de Referencia - PE 2024/0012",
  incoming: [
    { id: "r1", nodeLabel: "Lei 14.133/2021 Art. 6", type: "fundamenta", weight: 0.95, confidence: 0.98 },
    { id: "r2", nodeLabel: "ETP - Estudo Tecnico", type: "compoe", weight: 0.88, confidence: 0.91 },
    { id: "r3", nodeLabel: "Decreto 10.024/2019", type: "referencia", weight: 0.72, confidence: 0.85 },
    { id: "r4", nodeLabel: "IN SEGES 58/2022", type: "complementa", weight: 0.65, confidence: 0.78 },
    { id: "r5", nodeLabel: "Parecer Juridico 045/2024", type: "referencia", weight: 0.60, confidence: 0.82 },
  ],
  outgoing: [
    { id: "r6", nodeLabel: "Edital PE 2024/0012", type: "compoe", weight: 0.92, confidence: 0.96 },
    { id: "r7", nodeLabel: "Especificacoes Tecnicas", type: "exige", weight: 0.85, confidence: 0.90 },
    { id: "r8", nodeLabel: "Planilha de Custos", type: "complementa", weight: 0.78, confidence: 0.88 },
    { id: "r9", nodeLabel: "Criterios de Habilitacao", type: "exige", weight: 0.70, confidence: 0.84 },
  ],
};

function ConfidenceIndicator({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  return (
    <span
      className={`text-xs font-medium ${
        percent >= 90 ? "text-green-600" : percent >= 70 ? "text-yellow-600" : "text-red-600"
      }`}
    >
      {percent}%
    </span>
  );
}

function RelationshipRow({ rel }: { rel: Relationship }) {
  const weightPercent = Math.round(rel.weight * 100);
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{rel.nodeLabel}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${RELATION_STYLES[rel.type]}`}>
            {rel.type}
          </span>
          <ConfidenceIndicator value={rel.confidence} />
        </div>
      </div>
      <div className="w-24 flex-shrink-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs text-gray-500">Peso</span>
          <span className="text-xs font-medium text-gray-700">{weightPercent}%</span>
        </div>
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{ width: `${weightPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function RelationshipPanel() {
  const [data, setData] = useState<RelationshipData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setData(MOCK_DATA);
      setLoading(false);
    }, 750);
    return () => clearTimeout(timer);
  }, []);

  if (loading || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-56 bg-gray-200 rounded animate-pulse" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        <div className="h-6 w-56 bg-gray-200 rounded animate-pulse" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">
        Relacionamentos: <span className="text-gray-600">{data.nodeLabel}</span>
      </h2>

      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="text-gray-400">&larr;</span>
          Entrada ({data.incoming.length})
        </h3>
        <div className="divide-y divide-gray-100">
          {data.incoming.map((rel) => (
            <RelationshipRow key={rel.id} rel={rel} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          <span className="text-gray-400">&rarr;</span>
          Saida ({data.outgoing.length})
        </h3>
        <div className="divide-y divide-gray-100">
          {data.outgoing.map((rel) => (
            <RelationshipRow key={rel.id} rel={rel} />
          ))}
        </div>
      </section>
    </div>
  );
}
