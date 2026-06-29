import { useState, useEffect } from "react";

interface ValidationData {
  hallucinationRisk: string;
  unsupportedClaims: string[];
  contradictions: string[];
  missingEvidence: string[];
  groundingCoverage: number;
  evidenceUtilization: number;
  validationResult: string;
  requiresHumanApproval: boolean;
  confidence: number;
}

const mockValidation: ValidationData = {
  hallucinationRisk: "low",
  unsupportedClaims: ["A taxa de juros aplicável é de 12% ao ano."],
  contradictions: [],
  missingEvidence: ["Referência ao Decreto regulamentador"],
  groundingCoverage: 0.85,
  evidenceUtilization: 0.78,
  validationResult: "approved",
  requiresHumanApproval: false,
  confidence: 0.82,
};

const riskColors: Record<string, string> = {
  none: "bg-green-100 text-green-800",
  low: "bg-yellow-100 text-yellow-800",
  medium: "bg-orange-100 text-orange-800",
  high: "bg-red-100 text-red-800",
  critical: "bg-red-200 text-red-900",
};

const resultColors: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  needs_review: "bg-yellow-100 text-yellow-800",
  rejected: "bg-red-100 text-red-800",
  insufficient_evidence: "bg-gray-100 text-gray-800",
};

export default function ResponseValidationPanel() {
  const [loading, setLoading] = useState(true);

  useEffect(() => { setTimeout(() => setLoading(false), 500); }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-6 bg-gray-200 rounded w-1/3" />
        <div className="h-40 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">Validação da Resposta</h2>

      <div className="flex gap-3 flex-wrap">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${riskColors[mockValidation.hallucinationRisk] ?? ""}`}>
          Risco: {mockValidation.hallucinationRisk}
        </span>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${resultColors[mockValidation.validationResult] ?? ""}`}>
          {mockValidation.validationResult}
        </span>
        {mockValidation.requiresHumanApproval && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800">Aprovação Humana Necessária</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Cobertura de Grounding</span>
            <span className="font-medium">{(mockValidation.groundingCoverage * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${mockValidation.groundingCoverage * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Utilização de Evidências</span>
            <span className="font-medium">{(mockValidation.evidenceUtilization * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${mockValidation.evidenceUtilization * 100}%` }} />
          </div>
        </div>
      </div>

      {mockValidation.unsupportedClaims.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-red-700 mb-2">Afirmações Sem Suporte</h3>
          {mockValidation.unsupportedClaims.map((c, i) => (
            <div key={i} className="border-l-4 border-red-400 pl-3 py-1 text-sm text-gray-700">{c}</div>
          ))}
        </div>
      )}

      {mockValidation.missingEvidence.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-orange-700 mb-2">Evidências Ausentes</h3>
          {mockValidation.missingEvidence.map((e, i) => (
            <div key={i} className="border-l-4 border-orange-400 pl-3 py-1 text-sm text-gray-700">{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
