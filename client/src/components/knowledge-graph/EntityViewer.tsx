import React, { useState, useEffect } from "react";

type EntityType = "processo" | "documento" | "entidade" | "conceito" | "norma";

interface EntityMetadata {
  modalidade: string;
  orgao: string;
  valorEstimado: string;
  dataAbertura: string;
}

interface Entity {
  id: string;
  title: string;
  type: EntityType;
  description: string;
  aliases: string[];
  metadata: EntityMetadata;
  confidence: number;
  version: number;
  active: boolean;
}

const TYPE_STYLES: Record<EntityType, string> = {
  processo: "bg-blue-100 text-blue-800",
  documento: "bg-purple-100 text-purple-800",
  entidade: "bg-green-100 text-green-800",
  conceito: "bg-orange-100 text-orange-800",
  norma: "bg-red-100 text-red-800",
};

const MOCK_ENTITY: Entity = {
  id: "proc-2024-0012",
  title: "Pregao Eletronico 2024/0012",
  type: "processo",
  description:
    "Processo licitatório para aquisição de equipamentos de informática destinados à Secretaria Municipal de Saúde, modalidade pregão eletrônico, critério de julgamento menor preço por item.",
  aliases: [
    "PE 2024/0012",
    "Pregao TI Saude",
    "Licitacao Equipamentos Informatica",
  ],
  metadata: {
    modalidade: "Pregao Eletronico",
    orgao: "Secretaria Municipal de Saude",
    valorEstimado: "R$ 1.250.000,00",
    dataAbertura: "2024-08-15",
  },
  confidence: 0.92,
  version: 3,
  active: true,
};

export default function EntityViewer() {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setEntity(MOCK_ENTITY);
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  if (loading || !entity) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-7 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-5 w-24 bg-gray-200 rounded-full animate-pulse" />
        <div className="h-16 w-full bg-gray-200 rounded animate-pulse" />
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 w-28 bg-gray-200 rounded-full animate-pulse" />
          ))}
        </div>
        <div className="h-32 w-full bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-full bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  const confidencePercent = Math.round(entity.confidence * 100);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{entity.title}</h2>
          <span className={`mt-1 inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${TYPE_STYLES[entity.type]}`}>
            {entity.type}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${entity.active ? "text-green-600" : "text-red-600"}`}>
            <span className={`h-2 w-2 rounded-full ${entity.active ? "bg-green-500" : "bg-red-500"}`} />
            {entity.active ? "Ativo" : "Inativo"}
          </span>
          <span className="text-xs text-gray-400">v{entity.version}</span>
        </div>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed">{entity.description}</p>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Aliases</h3>
        <div className="flex flex-wrap gap-2">
          {entity.aliases.map((alias) => (
            <span key={alias} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              {alias}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Metadados</h3>
        <pre className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-xs text-gray-800 overflow-x-auto">
          {JSON.stringify(entity.metadata, null, 2)}
        </pre>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Confianca</h3>
          <span className="text-xs font-medium text-gray-700">{confidencePercent}%</span>
        </div>
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              confidencePercent >= 80 ? "bg-green-500" : confidencePercent >= 50 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
