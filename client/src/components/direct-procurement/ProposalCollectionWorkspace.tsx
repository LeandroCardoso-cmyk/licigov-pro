import React from "react";
import { trpc } from "../../lib/trpc";
import { formatCurrency } from "./labels";

/**
 * ProposalCollectionWorkspace — REAL (tRPC).
 *
 * Recebimento das propostas: cadastro de fornecedores, registro de propostas e
 * anexos por REFERÊNCIA (nunca cópia). SEM envio automático (Future Evolution).
 */

export interface ProposalCollectionWorkspaceProps {
  workspaceId: string;
  proposals?: Array<{ id: string; supplierName: string; supplierDocument: string; proposalValue: number; protocol: string; receivedVia: string }>;
}

export default function ProposalCollectionWorkspace({ workspaceId, proposals = [] }: ProposalCollectionWorkspaceProps) {
  const utils = trpc.useUtils();
  const [supplierName, setSupplierName] = React.useState("");
  const [supplierDocument, setSupplierDocument] = React.useState("");
  const [proposalValue, setProposalValue] = React.useState("");
  const [protocol, setProtocol] = React.useState("");

  const register = trpc.directProcurement.registerProposal.useMutation({
    onSuccess: () => {
      void utils.directProcurement.loadProcess.invalidate({ workspaceId });
      setSupplierName(""); setSupplierDocument(""); setProposalValue(""); setProtocol("");
    },
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Recebimento das Propostas</h3>
        <p className="text-xs text-muted-foreground">Anexos por referência. Sem envio automático nesta fase.</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (supplierName.trim()) register.mutate({ workspaceId, supplierName, supplierDocument: supplierDocument || undefined, proposalValue: proposalValue ? Number(proposalValue) : undefined, protocol: protocol || undefined, index: proposals.length }); }}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Fornecedor" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input value={supplierDocument} onChange={(e) => setSupplierDocument(e.target.value)} placeholder="CNPJ/CPF" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input type="number" step="0.01" value={proposalValue} onChange={(e) => setProposalValue(e.target.value)} placeholder="Valor (R$)" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input value={protocol} onChange={(e) => setProtocol(e.target.value)} placeholder="Protocolo" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <button type="submit" disabled={register.isPending || !supplierName.trim()} className="sm:col-span-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
          {register.isPending ? "Registrando…" : "Registrar proposta"}
        </button>
      </form>

      {proposals.length > 0 && (
        <ul className="divide-y divide-border">
          {proposals.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-foreground">{p.supplierName}</p>
                <p className="text-xs text-muted-foreground">{p.supplierDocument || "—"} · {p.protocol || "sem protocolo"} · {p.receivedVia}</p>
              </div>
              <span className="font-medium text-foreground">{formatCurrency(p.proposalValue)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
