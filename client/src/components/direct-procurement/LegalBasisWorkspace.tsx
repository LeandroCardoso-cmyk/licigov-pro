import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * LegalBasisWorkspace — REAL (tRPC).
 *
 * Seleção e justificativa do fundamento legal (Lei 14.133/2021). Nunca bloqueia:
 * o servidor pode escolher, alterar e justificar livremente.
 */

export interface LegalBasisWorkspaceProps {
  workspaceId: string;
  procurementType?: "dispensa" | "inexigibilidade";
  currentBasis?: string;
  onSaved?: () => void;
}

const SUGGESTIONS: Record<string, string[]> = {
  dispensa: ["Art. 75, I", "Art. 75, II", "Art. 75, IV", "Art. 75, VIII"],
  inexigibilidade: ["Art. 74, I", "Art. 74, II", "Art. 74, III", "Art. 74, IV"],
};

export default function LegalBasisWorkspace({ workspaceId, procurementType = "dispensa", currentBasis = "", onSaved }: LegalBasisWorkspaceProps) {
  const utils = trpc.useUtils();
  const [legalBasis, setLegalBasis] = React.useState(currentBasis);
  const [justification, setJustification] = React.useState("");
  const save = trpc.directProcurement.selectLegalBasis.useMutation({
    onSuccess: () => { void utils.directProcurement.loadProcess.invalidate({ workspaceId }); onSaved?.(); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (legalBasis.trim()) save.mutate({ workspaceId, legalBasis, justification: justification || undefined }); }}
      className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Fundamento Legal</h3>
      <div className="flex flex-wrap gap-2">
        {(SUGGESTIONS[procurementType] ?? []).map((s) => (
          <button key={s} type="button" onClick={() => setLegalBasis(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${legalBasis === s ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>{s}</button>
        ))}
      </div>
      <input value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} placeholder="Ex.: Art. 75, II"
        className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justificativa da escolha do fundamento…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      {save.isError && <p className="text-xs text-red-600 dark:text-red-400">{save.error.message}</p>}
      <button type="submit" disabled={save.isPending || !legalBasis.trim()} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {save.isPending ? "Salvando…" : "Salvar fundamento"}
      </button>
    </form>
  );
}
