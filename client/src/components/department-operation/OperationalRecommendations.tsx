import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * OperationalRecommendations — REAL (tRPC).
 *
 * Recomendações operacionais (priorização, gargalos, riscos, sobrecarga,
 * vencimentos) do Adaptive Recommendation Engine. Sempre com reasoning, confidence,
 * impacto e alternativas. O servidor SEMPRE decide — o sistema apenas recomenda.
 */

const KIND_LABELS: Record<string, string> = {
  priorizacao: "Priorização", gargalo: "Gargalo", risco: "Risco", sobrecarga: "Sobrecarga", vencimento: "Vencimento",
};
const KIND_CLASSES: Record<string, string> = {
  priorizacao: "bg-indigo-100 text-indigo-800", gargalo: "bg-amber-100 text-amber-800",
  risco: "bg-red-100 text-red-700", sobrecarga: "bg-orange-100 text-orange-800", vencimento: "bg-purple-100 text-purple-800",
};

export default function OperationalRecommendations() {
  const { data, isLoading } = trpc.departmentOperation.recommendations.useQuery({});
  const recs = data?.recommendations ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Recomendações</h3>
      {isLoading ? (
        <div className="h-20 animate-pulse rounded-md bg-muted" />
      ) : recs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma recomendação no momento. O departamento está em dia.</p>
      ) : (
        <ul className="space-y-3">
          {recs.map((r, i) => (
            <li key={i} className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_CLASSES[r.kind] ?? "bg-muted text-foreground"}`}>{KIND_LABELS[r.kind] ?? r.kind}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-200">confiança {Math.round(r.confidence * 100)}% · impacto {r.impact}</span>
              </div>
              <p className="text-sm font-medium text-foreground">{r.title}</p>
              <p className="text-xs text-muted-foreground">{r.reasoning}</p>
              {r.legalBasis.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Base legal: {r.legalBasis.join("; ")}</p>}
              {r.alternatives.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.alternatives.map((a, j) => <span key={j} className="rounded-md bg-card px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border">{a}</span>)}
                </div>
              )}
              <p className="mt-1 text-[11px] italic text-indigo-700">Recomendação — o servidor sempre decide.</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
