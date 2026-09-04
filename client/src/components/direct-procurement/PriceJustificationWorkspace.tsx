import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * PriceJustificationWorkspace — REAL (tRPC).
 *
 * Justificativa do preço: a partir da Pesquisa de Preços (reutilizada), manual ou
 * por documento anexado. Importa pesquisa reutilizando o Price Research Workspace.
 */

export interface PriceJustificationWorkspaceProps {
  workspaceId: string;
}

export default function PriceJustificationWorkspace({ workspaceId }: PriceJustificationWorkspaceProps) {
  const [source, setSource] = React.useState<"pesquisa" | "manual" | "documento">("pesquisa");
  const [justification, setJustification] = React.useState("");
  const [referenceValue, setReferenceValue] = React.useState("");
  const [researchText, setResearchText] = React.useState("");
  const [researchId, setResearchId] = React.useState("");

  const importResearch = trpc.directProcurement.importPriceResearch.useMutation({
    onSuccess: (res) => setResearchId(res.researchId),
  });
  const save = trpc.directProcurement.generatePriceJustification.useMutation();

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Justificativa do Preço</h3>

      <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
        {(["pesquisa", "manual", "documento"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSource(s)} className={`rounded-md px-3 py-1 capitalize transition ${source === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{s}</button>
        ))}
      </div>

      {source === "pesquisa" && (
        <div className="space-y-2 rounded-md border border-cyan-100 dark:border-cyan-900 bg-cyan-50/40 dark:bg-cyan-950/40 p-3">
          <p className="text-xs text-cyan-800 dark:text-cyan-200">Reutiliza o Price Research Workspace. Cole os itens (descrição;qtd;un;valor).</p>
          <textarea value={researchText} onChange={(e) => setResearchText(e.target.value)} rows={3} placeholder="Caneta;100;un;1,50"
            className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <button type="button" onClick={() => importResearch.mutate({ workspaceId, source: "colar", text: researchText })} disabled={importResearch.isPending || !researchText.trim()}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50">
            {importResearch.isPending ? "Importando…" : "Importar pesquisa"}
          </button>
          {importResearch.data && <p className="text-xs text-green-700 dark:text-green-300">{importResearch.data.itemCount} item(ns) importado(s).</p>}
        </div>
      )}

      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justificativa do preço de referência…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <label className="block text-xs font-medium text-foreground">Valor de referência (R$)
        <input type="number" step="0.01" value={referenceValue} onChange={(e) => setReferenceValue(e.target.value)}
          className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>

      {save.isError && <p className="text-xs text-red-600 dark:text-red-400">{save.error.message}</p>}
      {save.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Justificativa do preço registrada.</p>}
      <button type="button" onClick={() => save.mutate({ workspaceId, source, justification: justification || undefined, referenceValue: referenceValue ? Number(referenceValue) : undefined, researchId: researchId || undefined })}
        disabled={save.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {save.isPending ? "Salvando…" : "Salvar justificativa do preço"}
      </button>
    </div>
  );
}
