import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * RatificationWorkspace — REAL (tRPC).
 *
 * Ratificação da contratação direta: responsável, decisão, justificativa, data e
 * evidências. Reutiliza o Approval Engine (evento de aprovação na timeline).
 */

export interface RatificationWorkspaceProps {
  workspaceId: string;
  onRatified?: () => void;
}

export default function RatificationWorkspace({ workspaceId, onRatified }: RatificationWorkspaceProps) {
  const utils = trpc.useUtils();
  const [decision, setDecision] = React.useState<"ratificado" | "nao_ratificado">("ratificado");
  const [justification, setJustification] = React.useState("");
  const [evidence, setEvidence] = React.useState("");

  const ratify = trpc.directProcurement.ratify.useMutation({
    onSuccess: () => { void utils.directProcurement.loadProcess.invalidate({ workspaceId }); onRatified?.(); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); ratify.mutate({ workspaceId, decision, justification: justification || undefined, evidence: evidence ? evidence.split("\n").filter(Boolean) : undefined }); }}
      className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Ratificação</h3>
      <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
        <button type="button" onClick={() => setDecision("ratificado")} className={`rounded-md px-3 py-1 transition ${decision === "ratificado" ? "bg-card text-green-700 dark:text-green-300 shadow-sm" : "text-muted-foreground"}`}>Ratificar</button>
        <button type="button" onClick={() => setDecision("nao_ratificado")} className={`rounded-md px-3 py-1 transition ${decision === "nao_ratificado" ? "bg-card text-red-700 dark:text-red-300 shadow-sm" : "text-muted-foreground"}`}>Não ratificar</button>
      </div>
      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justificativa da decisão…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} placeholder="Evidências (uma por linha)…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      {ratify.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Ratificação registrada.</p>}
      <button type="submit" disabled={ratify.isPending} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
        {ratify.isPending ? "Registrando…" : "Registrar ratificação"}
      </button>
    </form>
  );
}
