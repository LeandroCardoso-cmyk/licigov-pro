import React, { useState, useEffect } from "react";

type OperationType = "create" | "update" | "delete";

interface ChangeField {
  key: string;
  before: string | null;
  after: string | null;
}

interface ChangelogEntry {
  id: string;
  entityType: string;
  entityName: string;
  operation: OperationType;
  timestamp: string;
  changedBy: string;
  changes: ChangeField[];
}

const operationColors: Record<OperationType, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
};

const entityTypeColors: Record<string, string> = {
  Processo: "bg-indigo-100 text-indigo-800",
  Fornecedor: "bg-cyan-100 text-cyan-800",
  Documento: "bg-amber-100 text-amber-800",
  Servidor: "bg-pink-100 text-pink-800",
  Categoria: "bg-teal-100 text-teal-800",
};

const mockChangelog: ChangelogEntry[] = [
  {
    id: "log-1",
    entityType: "Processo",
    entityName: "Pregão 2024/0089",
    operation: "update",
    timestamp: "04/07/2026 14:32",
    changedBy: "Maria Santos",
    changes: [
      { key: "status", before: "Em Andamento", after: "Homologado" },
      { key: "data_homologacao", before: null, after: "04/07/2026" },
    ],
  },
  {
    id: "log-2",
    entityType: "Fornecedor",
    entityName: "Tech Solutions Ltda",
    operation: "create",
    timestamp: "04/07/2026 11:15",
    changedBy: "Carlos Oliveira",
    changes: [
      { key: "cnpj", before: null, after: "12.345.678/0001-90" },
      { key: "razao_social", before: null, after: "Tech Solutions Ltda" },
      { key: "porte", before: null, after: "ME" },
    ],
  },
  {
    id: "log-3",
    entityType: "Documento",
    entityName: "TR-2024/0045",
    operation: "update",
    timestamp: "03/07/2026 16:48",
    changedBy: "Ana Pereira",
    changes: [
      { key: "versao", before: "2", after: "3" },
      { key: "valor_estimado", before: "R$ 150.000,00", after: "R$ 178.500,00" },
    ],
  },
  {
    id: "log-4",
    entityType: "Servidor",
    entityName: "Roberto Lima",
    operation: "update",
    timestamp: "03/07/2026 09:20",
    changedBy: "Admin Sistema",
    changes: [
      { key: "funcao", before: "Membro CPL", after: "Pregoeiro" },
      { key: "portaria", before: "Port. 123/2024", after: "Port. 456/2026" },
    ],
  },
  {
    id: "log-5",
    entityType: "Processo",
    entityName: "Dispensa 2024/0034",
    operation: "delete",
    timestamp: "02/07/2026 17:05",
    changedBy: "Maria Santos",
    changes: [
      { key: "motivo", before: null, after: "Duplicidade - processo cancelado" },
      { key: "status", before: "Pendente", after: "Cancelado" },
    ],
  },
  {
    id: "log-6",
    entityType: "Categoria",
    entityName: "CATMAT-46101",
    operation: "update",
    timestamp: "02/07/2026 10:33",
    changedBy: "Sistema CATMAT",
    changes: [{ key: "descricao", before: "Combustíveis Automotivos", after: "Combustíveis e Lubrificantes Automotivos" }],
  },
  {
    id: "log-7",
    entityType: "Documento",
    entityName: "ETP-2024/0067",
    operation: "create",
    timestamp: "01/07/2026 15:22",
    changedBy: "Carlos Oliveira",
    changes: [
      { key: "tipo", before: null, after: "ETP" },
      { key: "processo_vinculado", before: null, after: "Pregão 2024/0067" },
      { key: "status", before: null, after: "Rascunho" },
    ],
  },
  {
    id: "log-8",
    entityType: "Fornecedor",
    entityName: "Alpha Serviços ME",
    operation: "update",
    timestamp: "01/07/2026 08:45",
    changedBy: "Ana Pereira",
    changes: [
      { key: "situacao_cadastral", before: "Regular", after: "Inapta" },
      { key: "data_consulta", before: "15/06/2026", after: "01/07/2026" },
    ],
  },
];

function GraphLineageViewer() {
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setChangelog(mockChangelog);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg border p-4">
            <div className="mb-2 flex gap-2">
              <div className="h-5 w-16 rounded bg-gray-200" />
              <div className="h-5 w-14 rounded bg-gray-200" />
            </div>
            <div className="h-4 w-3/4 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-bold text-gray-800">Histórico de Alterações do Grafo</h2>
      <div className="relative space-y-4">
        <div className="absolute bottom-0 left-4 top-0 w-0.5 bg-gray-200" />
        {changelog.map((entry) => (
          <div key={entry.id} className="relative ml-8 rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="absolute -left-6 top-5 h-3 w-3 rounded-full border-2 border-white bg-gray-400" />
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  entityTypeColors[entry.entityType] || "bg-gray-100 text-gray-800"
                }`}
              >
                {entry.entityType}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${operationColors[entry.operation]}`}>
                {entry.operation}
              </span>
              <span className="text-sm font-medium text-gray-900">{entry.entityName}</span>
            </div>
            <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
              <span>{entry.timestamp}</span>
              <span>por {entry.changedBy}</span>
            </div>
            <div className="rounded bg-gray-50 p-2">
              {entry.changes.map((change, idx) => (
                <div key={idx} className="flex gap-4 py-0.5 text-xs">
                  <span className="w-32 shrink-0 font-mono text-gray-600">{change.key}:</span>
                  <span className="text-gray-400">{change.before ?? "—"}</span>
                  <span className="text-gray-400">→</span>
                  <span className="rounded bg-yellow-100 px-1 font-medium text-gray-800">
                    {change.after ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default GraphLineageViewer;
