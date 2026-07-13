import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * NeedCharacterizationWorkspace — REAL (tRPC).
 *
 * Caracterização da necessidade: descrição, justificativa e valor estimado.
 * Tudo editável — base para as justificativas e o parecer jurídico.
 */

export interface NeedCharacterizationWorkspaceProps {
  workspaceId: string;
  onSaved?: () => void;
}

export default function NeedCharacterizationWorkspace({ workspaceId, onSaved }: NeedCharacterizationWorkspaceProps) {
  const [description, setDescription] = React.useState("");
  const [justification, setJustification] = React.useState("");
  const [estimatedValue, setEstimatedValue] = React.useState("");
  const save = trpc.directProcurement.characterizeNeed.useMutation({ onSuccess: () => onSaved?.() });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate({ workspaceId, description, justification, estimatedValue: estimatedValue ? Number(estimatedValue) : undefined }); }}
      className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Caracterização da Necessidade</h3>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Descrição da necessidade…"
        className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justificativa da necessidade…"
        className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <label className="block text-xs font-medium text-gray-700">Valor estimado (R$)
        <input type="number" step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      {save.isSuccess && <p className="text-xs text-green-700">Necessidade registrada.</p>}
      <button type="submit" disabled={save.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {save.isPending ? "Salvando…" : "Salvar caracterização"}
      </button>
    </form>
  );
}
