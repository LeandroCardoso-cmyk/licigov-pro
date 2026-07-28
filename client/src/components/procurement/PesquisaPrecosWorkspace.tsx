import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * PesquisaPrecosWorkspace — REAL (wired to tRPC).
 *
 * UX: cole a pesquisa de preços; o servidor extrai e transforma cada linha em
 * um ITEM INTELIGENTE enriquecido. O operador depois valida no workspace de itens.
 */

type ResearchSource = "pdf" | "docx" | "xlsx" | "csv" | "colar" | "manual";

const SOURCE_LABELS: Record<ResearchSource, string> = {
  pdf: "PDF",
  docx: "DOCX",
  xlsx: "XLSX",
  csv: "CSV",
  colar: "Colar texto",
  manual: "Manual",
};

export type PesquisaPrecosWorkspaceProps = {
  processId?: string;
};

export default function PesquisaPrecosWorkspace({
  processId = "",
}: PesquisaPrecosWorkspaceProps) {
  const [source, setSource] = useState<ResearchSource>("colar");
  const [text, setText] = useState("");

  const importResearch =
    trpc.procurementProcess.importPriceResearch.useMutation();
  const items = importResearch.data?.intelligentItems ?? [];

  const handleImport = () => {
    if (!processId || !text.trim()) return;
    importResearch.mutate({ processId, source, text: text.trim() });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        Pesquisa de Preços
      </h1>
      <p className="text-sm text-muted-foreground">
        Cada linha extraída vira um Item Inteligente enriquecido.
      </p>

      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <label className="mb-3 flex flex-col text-sm sm:max-w-xs">
          <span className="mb-1 font-medium text-foreground">Fonte</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as ResearchSource)}
            className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
          >
            {(Object.keys(SOURCE_LABELS) as ResearchSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">
            Conteúdo da pesquisa
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Cole aqui as cotações / itens da pesquisa de preços..."
            className="rounded-lg border border-input px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleImport}
          disabled={!processId || !text.trim() || importResearch.isPending}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {importResearch.isPending
            ? "Processando..."
            : "Importar e gerar Itens Inteligentes"}
        </button>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para importar a pesquisa.
          </p>
        )}
        {importResearch.isError && (
          <p className="mt-2 text-sm text-destructive">
            Falha ao importar a pesquisa.
          </p>
        )}
      </div>

      {importResearch.isSuccess && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <p className="mb-3 text-sm font-medium text-green-700">
            {items.length} Item(ns) Inteligente(s) gerado(s).
          </p>
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-foreground">{it.description}</span>
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  CATMAT: {it.suggestedCATMAT ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
