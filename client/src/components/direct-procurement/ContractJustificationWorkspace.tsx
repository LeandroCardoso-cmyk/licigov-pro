import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ContractJustificationWorkspace — REAL (tRPC).
 *
 * Justificativa da contratação, gerada pelos copilotos (Multi-Copilot Orchestrator)
 * como rascunho REVISÁVEL. A recomendação traz reasoning, explainability, provenance
 * e confidence — e pode ser rejeitada. Nunca automática.
 */

export interface ContractJustificationWorkspaceProps {
  workspaceId: string;
}

export default function ContractJustificationWorkspace({ workspaceId }: ContractJustificationWorkspaceProps) {
  const generate = trpc.directProcurement.generateJustification.useMutation();
  const rec = generate.data?.recommendation;
  const j = generate.data?.justification;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Justificativa da Contratação</h3>
        <button type="button" onClick={() => generate.mutate({ workspaceId })} disabled={generate.isPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {generate.isPending ? "Gerando…" : "Gerar com copilotos"}
        </button>
      </div>

      {generate.isError && <p className="text-xs text-red-600">{generate.error.message}</p>}

      {rec && (
        <div className="rounded-md border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-indigo-900">Recomendação (revisável)</span>
            <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-indigo-700 ring-1 ring-inset ring-indigo-200">confiança {Math.round(rec.confidence * 100)}%</span>
          </div>
          <p className="text-foreground"><strong>Reasoning:</strong> {rec.reasoning}</p>
          <p className="text-muted-foreground"><strong>Explainability:</strong> {rec.explainability}</p>
          <p className="text-muted-foreground"><strong>Provenance:</strong> {rec.provenance}</p>
        </div>
      )}

      {j && (
        <dl className="space-y-2 text-sm">
          {[["Necessidade", j.need], ["Interesse público", j.publicInterest], ["Motivação", j.motivation], ["Fundamento", j.legalFoundation], ["Benefícios", j.benefits], ["Alternativas", j.alternatives]].map(([k, v]) => (
            <div key={k as string} className="border-b border-border pb-1 last:border-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="whitespace-pre-wrap text-foreground">{(v as string) || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      {!j && !generate.isPending && <p className="text-xs text-muted-foreground">Gere um rascunho fundamentado a partir dos copilotos do domínio.</p>}
    </div>
  );
}
