import React from "react";

type RiskSeverity = "baixo" | "medio" | "alto" | "critico";

export interface WorkspaceRisk {
  id: string;
  category: string;
  description: string;
  severity: RiskSeverity;
  status: string;
  mitigation?: string;
}

interface WorkspaceRiskPanelProps {
  risks?: WorkspaceRisk[];
}

const DEFAULT_RISKS: WorkspaceRisk[] = [
  {
    id: "r1",
    category: "Jurídico",
    description: "Ausência de justificativa técnica no ETP.",
    severity: "critico",
    status: "aberto",
    mitigation: "Complementar ETP com fundamentação técnica.",
  },
  {
    id: "r2",
    category: "Orçamentário",
    description: "Pesquisa de preços com amostra insuficiente.",
    severity: "alto",
    status: "em_analise",
    mitigation: "Ampliar cotações para no mínimo três fontes.",
  },
  {
    id: "r3",
    category: "Prazo",
    description: "Cronograma apertado para publicação do edital.",
    severity: "medio",
    status: "monitorado",
    mitigation: "Revisar marcos e antecipar tarefas críticas.",
  },
  {
    id: "r4",
    category: "Operacional",
    description: "Documentação anexa incompleta.",
    severity: "baixo",
    status: "mitigado",
    mitigation: "Checklist de anexos aplicado.",
  },
];

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  baixo: "bg-green-100 text-green-700",
  medio: "bg-yellow-100 text-yellow-700",
  alto: "bg-orange-100 text-orange-700",
  critico: "bg-red-100 text-red-700",
};

const SEVERITY_LABELS: Record<RiskSeverity, string> = {
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
  critico: "Crítico",
};

export default function WorkspaceRiskPanel({
  risks = DEFAULT_RISKS,
}: WorkspaceRiskPanelProps) {
  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Painel de Riscos
      </h2>
      <ul className="space-y-3">
        {risks.map((risk) => (
          <li
            key={risk.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLES[risk.severity]}`}
                >
                  {SEVERITY_LABELS[risk.severity]}
                </span>
                <span className="text-xs font-medium text-gray-500">
                  {risk.category}
                </span>
              </div>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {risk.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-800">{risk.description}</p>
            {risk.mitigation && (
              <p className="mt-1 text-xs text-gray-500">
                Mitigação: {risk.mitigation}
              </p>
            )}
          </li>
        ))}
        {risks.length === 0 && (
          <li className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            Nenhum risco registrado.
          </li>
        )}
      </ul>
    </div>
  );
}
