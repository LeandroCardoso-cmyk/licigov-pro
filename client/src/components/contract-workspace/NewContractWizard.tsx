import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * NewContractWizard — REAL (tRPC).
 *
 * Cria contrato pelas TRÊS origens: Processo Licitatório, Contratação Direta e
 * importação de contrato externo (PDF/DOCX → texto → extração → reconstrução).
 */

export interface NewContractWizardProps {
  onCreated?: (contractId: string) => void;
}

type Origin = "processo_licitatorio" | "contratacao_direta" | "externo";

export default function NewContractWizard({ onCreated }: NewContractWizardProps) {
  const utils = trpc.useUtils();
  const [origin, setOrigin] = React.useState<Origin>("externo");
  const [contractNumber, setContractNumber] = React.useState("");
  const [originId, setOriginId] = React.useState("");
  const [rawText, setRawText] = React.useState("");

  const onOk = (contractId: string) => { void utils.contractWorkspace.listContracts.invalidate(); onCreated?.(contractId); };
  const fromProc = trpc.contractWorkspace.createFromProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const fromDirect = trpc.contractWorkspace.createFromDirectProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const importExt = trpc.contractWorkspace.importExternalContract.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });

  const busy = fromProc.isPending || fromDirect.isPending || importExt.isPending;
  const err = fromProc.error?.message ?? fromDirect.error?.message ?? importExt.error?.message;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (origin === "processo_licitatorio") fromProc.mutate({ processId: originId, contractNumber });
    else if (origin === "contratacao_direta") fromDirect.mutate({ directWorkspaceId: originId, contractNumber });
    else importExt.mutate({ source: "pdf", rawText, contractNumber: contractNumber || undefined });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Novo Contrato</h2>

      <div className="grid grid-cols-3 gap-2">
        {([["processo_licitatorio", "Do Processo"], ["contratacao_direta", "Da Contratação Direta"], ["externo", "Externo (import)"]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setOrigin(v)}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition ${origin === v ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 text-gray-600 hover:border-indigo-300"}`}>{label}</button>
        ))}
      </div>

      <label className="block text-xs font-medium text-gray-700">Número do contrato
        <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="CT-2026/001"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>

      {origin !== "externo" ? (
        <label className="block text-xs font-medium text-gray-700">
          {origin === "processo_licitatorio" ? "ID do Processo Licitatório" : "ID da Contratação Direta"}
          <input value={originId} onChange={(e) => setOriginId(e.target.value)} placeholder="id de origem"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
      ) : (
        <label className="block text-xs font-medium text-gray-700">Texto do contrato (PDF/DOCX convertido)
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={5} placeholder="Cole aqui o texto do contrato externo…"
            className="mt-1 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <span className="text-[11px] text-gray-400">O sistema extrai número, contratado, objeto, valor e vigência automaticamente.</span>
        </label>
      )}

      {err && <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
      {importExt.data && <p className="text-xs text-green-700">Importado com confiança {Math.round(importExt.data.confidence * 100)}%.</p>}

      <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Criando…" : origin === "externo" ? "Importar contrato" : "Gerar contrato"}
      </button>
    </form>
  );
}
