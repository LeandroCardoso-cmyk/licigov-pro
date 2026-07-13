import React from "react";
import { trpc } from "../../lib/trpc";
import { formatDate } from "./labels";

/**
 * OccurrenceWorkspace — REAL (tRPC).
 *
 * Registro SIMPLES de ocorrências (descrição, data, anexos, observações). Sem
 * workflow complexo e sem fiscalização avançada — foco documental apenas.
 */

export interface OccurrenceWorkspaceProps {
  contractId: string;
  occurrences?: Array<{ id: string; description: string; occurredOn: string; notes: string; createdAt: string }>;
}

export default function OccurrenceWorkspace({ contractId, occurrences = [] }: OccurrenceWorkspaceProps) {
  const utils = trpc.useUtils();
  const [description, setDescription] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const register = trpc.contractWorkspace.registerOccurrence.useMutation({
    onSuccess: () => { void utils.contractWorkspace.loadContract.invalidate({ contractId }); setDescription(""); setNotes(""); },
  });

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Ocorrências</h3>

      <form onSubmit={(e) => { e.preventDefault(); if (description.trim()) register.mutate({ contractId, description, notes: notes || undefined }); }} className="space-y-2">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição da ocorrência" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações (opcional)…" className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button type="submit" disabled={register.isPending || !description.trim()} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {register.isPending ? "Registrando…" : "Registrar ocorrência"}
        </button>
      </form>

      {occurrences.length > 0 && (
        <ul className="divide-y divide-gray-50">
          {occurrences.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div><p className="text-gray-800">{o.description}</p>{o.notes && <p className="text-xs text-gray-500">{o.notes}</p>}</div>
              <span className="shrink-0 text-[11px] text-gray-400">{formatDate(o.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
