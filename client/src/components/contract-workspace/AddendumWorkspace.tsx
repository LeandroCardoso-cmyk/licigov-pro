import React from "react";
import { trpc } from "../../lib/trpc";
import { ADDENDUM_TYPE_LABELS } from "./labels";

/**
 * AddendumWorkspace — REAL (tRPC).
 *
 * Termos aditivos (prazo/valor/quantitativo/qualitativo). Fluxo: solicitar →
 * justificar → gerar minuta → parecer jurídico (quando o Adaptive Engine exigir)
 * → documento final. Aditivos de valor/quantitativo requerem parecer.
 */

export interface AddendumWorkspaceProps {
  contractId: string;
  addenda?: Array<{ id: string; addendumType: string; sequence: number; justification: string; newValue: number; newTerm: string; status: string }>;
}

const TYPES: Array<"prazo" | "valor" | "quantitativo" | "qualitativo"> = ["prazo", "valor", "quantitativo", "qualitativo"];

export default function AddendumWorkspace({ contractId, addenda = [] }: AddendumWorkspaceProps) {
  const utils = trpc.useUtils();
  const [addendumType, setAddendumType] = React.useState<"prazo" | "valor" | "quantitativo" | "qualitativo">("prazo");
  const [justification, setJustification] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [newTerm, setNewTerm] = React.useState("");

  const create = trpc.contractWorkspace.createAddendum.useMutation({
    onSuccess: () => { void utils.contractWorkspace.loadContract.invalidate({ contractId }); setJustification(""); setNewValue(""); setNewTerm(""); },
  });

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Termos Aditivos</h3>

      <form onSubmit={(e) => { e.preventDefault(); if (justification.trim()) create.mutate({ contractId, addendumType, justification, newValue: newValue ? Number(newValue) : undefined, newTerm: newTerm || undefined }); }} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setAddendumType(t)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${addendumType === t ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>{ADDENDUM_TYPE_LABELS[t]}</button>
          ))}
        </div>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Justificativa do aditivo…" className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          {addendumType === "valor" && <input type="number" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Novo valor (R$)" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
          {addendumType === "prazo" && <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Nova vigência" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
        </div>
        <button type="submit" disabled={create.isPending || !justification.trim()} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {create.isPending ? "Gerando…" : "Criar aditivo + minuta"}
        </button>
        {create.data?.requiresLegalOpinion && <p className="text-xs text-amber-700">Este aditivo requer parecer jurídico (Adaptive Process Engine).</p>}
      </form>

      {addenda.length > 0 && (
        <ul className="divide-y divide-gray-50">
          {addenda.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-gray-800">Aditivo {a.sequence} — {ADDENDUM_TYPE_LABELS[a.addendumType] ?? a.addendumType}</p>
                <p className="line-clamp-1 text-xs text-gray-500">{a.justification}</p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{a.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
