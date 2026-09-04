import React from "react";
import { trpc } from "../../lib/trpc";
import { formatCurrency } from "./labels";

/**
 * ContractEditor — REAL (tRPC).
 *
 * Edição supervisionada do contrato: objeto, prazos, valor, contratado, gestor e
 * fiscal (não obrigatórios). Cláusulas/garantias/penalidades editáveis via minutas.
 */

export interface ContractData {
  id: string; contractNumber: string; contractor: string; object: string;
  value: number; term: string; manager: string; inspector: string;
}

export interface ContractEditorProps { contract: ContractData; onSaved?: () => void }

export default function ContractEditor({ contract, onSaved }: ContractEditorProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = React.useState({
    contractor: contract.contractor, object: contract.object, term: contract.term,
    value: String(contract.value), manager: contract.manager, inspector: contract.inspector,
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = trpc.contractWorkspace.updateContract.useMutation({
    onSuccess: () => { void utils.contractWorkspace.loadContract.invalidate({ contractId: contract.id }); onSaved?.(); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate({ contractId: contract.id, contractor: form.contractor, object: form.object, term: form.term, value: Number(form.value) || 0, manager: form.manager, inspector: form.inspector }); }}
      className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Contrato {contract.contractNumber}</h3>
        <span className="text-xs text-muted-foreground">{formatCurrency(Number(form.value) || 0)}</span>
      </div>
      <label className="block text-xs font-medium text-foreground">Contratado
        <input value={form.contractor} onChange={(e) => set("contractor", e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <label className="block text-xs font-medium text-foreground">Objeto
        <textarea value={form.object} onChange={(e) => set("object", e.target.value)} rows={2} className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-foreground">Valor (R$)
          <input type="number" step="0.01" value={form.value} onChange={(e) => set("value", e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
        <label className="block text-xs font-medium text-foreground">Vigência
          <input value={form.term} onChange={(e) => set("term", e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
        <label className="block text-xs font-medium text-foreground">Gestor (opcional)
          <input value={form.manager} onChange={(e) => set("manager", e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
        <label className="block text-xs font-medium text-foreground">Fiscal (opcional)
          <input value={form.inspector} onChange={(e) => set("inspector", e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
      </div>
      {save.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Contrato atualizado.</p>}
      <button type="submit" disabled={save.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {save.isPending ? "Salvando…" : "Salvar contrato"}
      </button>
    </form>
  );
}
