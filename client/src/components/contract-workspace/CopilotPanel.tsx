import React from "react";

/**
 * CopilotPanel — PRESENTATIONAL.
 *
 * Exibe a recomendação dos copilotos (Jurídico, Contratos, Agente de Contratação)
 * com reasoning, explainability, provenance e confidence. Toda recomendação é
 * SUPERVISIONADA e pode ser REJEITADA — os copilotos nunca decidem.
 */

export interface CopilotRecommendation {
  reasoning: string;
  explainability: string;
  provenance: string;
  confidence: number;
}

export interface CopilotPanelProps {
  recommendation?: CopilotRecommendation | null;
  onAccept?: () => void;
  onReject?: () => void;
  busy?: boolean;
}

export default function CopilotPanel({ recommendation = null, onAccept, onReject, busy = false }: CopilotPanelProps) {
  return (
    <div className="rounded-lg border border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Copilotos (supervisionados)</h3>
        {recommendation && (
          <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800">
            confiança {Math.round(recommendation.confidence * 100)}%
          </span>
        )}
      </div>

      {!recommendation ? (
        <p className="text-xs text-muted-foreground">{busy ? "Consultando copilotos…" : "Nenhuma recomendação gerada ainda. Os copilotos nunca decidem — apenas sugerem."}</p>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-foreground"><strong>Reasoning:</strong> {recommendation.reasoning}</p>
          <p className="text-muted-foreground"><strong>Explainability:</strong> {recommendation.explainability}</p>
          <p className="text-muted-foreground"><strong>Provenance:</strong> {recommendation.provenance}</p>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onAccept} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Aceitar (revisar)</button>
            <button type="button" onClick={onReject} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Rejeitar</button>
          </div>
          <p className="pt-1 text-[11px] italic text-indigo-700 dark:text-indigo-300">Sugestão revisável — nunca automática.</p>
        </div>
      )}
    </div>
  );
}
