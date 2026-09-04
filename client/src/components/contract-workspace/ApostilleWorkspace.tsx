import React from "react";
import { trpc } from "../../lib/trpc";
import { APOSTILLE_KIND_LABELS } from "./labels";

/**
 * ApostilleWorkspace — REAL (tRPC).
 *
 * Apostilamentos (reajuste, alteração de gestor/fiscal, alterações permitidas em
 * lei). A minuta é gerada automaticamente ao registrar o apostilamento.
 */

export interface ApostilleWorkspaceProps {
  contractId: string;
  apostilles?: Array<{ id: string; kind: string; sequence: number; description: string; newValue: number; newManager: string; newInspector: string }>;
}

const KINDS: Array<"reajuste" | "gestor" | "fiscal" | "legal"> = ["reajuste", "gestor", "fiscal", "legal"];

export default function ApostilleWorkspace({ contractId, apostilles = [] }: ApostilleWorkspaceProps) {
  const utils = trpc.useUtils();
  const [kind, setKind] = React.useState<"reajuste" | "gestor" | "fiscal" | "legal">("reajuste");
  const [description, setDescription] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [newManager, setNewManager] = React.useState("");
  const [newInspector, setNewInspector] = React.useState("");

  const create = trpc.contractWorkspace.createApostille.useMutation({
    onSuccess: () => { void utils.contractWorkspace.loadContract.invalidate({ contractId }); setDescription(""); setNewValue(""); setNewManager(""); setNewInspector(""); },
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Apostilamentos</h3>

      <form onSubmit={(e) => { e.preventDefault(); create.mutate({ contractId, kind, description: description || undefined, newValue: newValue ? Number(newValue) : undefined, newManager: newManager || undefined, newInspector: newInspector || undefined }); }} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${kind === k ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>{APOSTILLE_KIND_LABELS[k]}</button>
          ))}
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Descrição do apostilamento…" className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        {kind === "reajuste" && <input type="number" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Novo valor (R$)" className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
        {kind === "gestor" && <input value={newManager} onChange={(e) => setNewManager(e.target.value)} placeholder="Novo gestor" className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
        {kind === "fiscal" && <input value={newInspector} onChange={(e) => setNewInspector(e.target.value)} placeholder="Novo fiscal" className="w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
        <button type="submit" disabled={create.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {create.isPending ? "Gerando…" : "Registrar apostilamento + minuta"}
        </button>
      </form>

      {apostilles.length > 0 && (
        <ul className="divide-y divide-border">
          {apostilles.map((a) => (
            <li key={a.id} className="py-2 text-sm">
              <p className="font-medium text-foreground">Apostilamento {a.sequence} — {APOSTILLE_KIND_LABELS[a.kind] ?? a.kind}</p>
              <p className="line-clamp-1 text-xs text-muted-foreground">{a.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
