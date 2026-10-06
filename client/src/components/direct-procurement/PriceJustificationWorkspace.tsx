import React from "react";
import { trpc } from "../../lib/trpc";
import { hydrationKey, useHydratedForm } from "../../lib/formHydration";

/**
 * PriceJustificationWorkspace — REAL (tRPC).
 *
 * Justificativa do preço: a partir da Pesquisa de Preços (reutilizada), manual ou
 * por documento anexado. Importa pesquisa reutilizando o Price Research Workspace.
 *
 * R5 / PR-11 (SEM-022) — o registro oficial exige justificativa (≥ 10 caracteres), valor de referência > 0 e aceite
 * explícito (`confirmOfficial`); o formulário hidrata o que já está registrado (nunca abre em branco sobre ele).
 */

export interface PriceJustificationWorkspaceProps {
  workspaceId: string;
}

type Source = "pesquisa" | "manual" | "documento";
const EMPTY = { source: "pesquisa", justification: "", referenceValue: "" };
const MIN_CHARS = 10;

export default function PriceJustificationWorkspace({ workspaceId }: PriceJustificationWorkspaceProps) {
  const utils = trpc.useUtils();
  const persisted = trpc.directProcurement.getJustifications.useQuery({ workspaceId });
  const current = persisted.data?.price ?? null;
  const server = React.useMemo(() => current
    ? { source: current.source, justification: current.justification, referenceValue: current.referenceValue > 0 ? String(current.referenceValue) : "" }
    : null, [current]);
  const form = useHydratedForm({ server, empty: EMPTY, key: hydrationKey(workspaceId, current?.id, current?.justification, current?.referenceValue), loading: persisted.isLoading });
  const source = (form.values.source ?? "pesquisa") as Source;
  const [researchText, setResearchText] = React.useState("");
  const [researchId, setResearchId] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);

  const importResearch = trpc.directProcurement.importPriceResearch.useMutation({
    onSuccess: (res) => setResearchId(res.researchId),
  });
  const save = trpc.directProcurement.generatePriceJustification.useMutation({
    onSuccess: () => { setConfirm(false); void utils.directProcurement.getJustifications.invalidate({ workspaceId }); },
  });

  const justification = form.values.justification ?? "";
  const value = Number(form.values.referenceValue ?? "");
  const valid = justification.trim().length >= MIN_CHARS && Number.isFinite(value) && value > 0;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Justificativa do Preço</h3>

      <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
        {(["pesquisa", "manual", "documento"] as const).map((s) => (
          <button key={s} type="button" onClick={() => form.setField("source", s)} className={`rounded-md px-3 py-1 capitalize transition ${source === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{s}</button>
        ))}
      </div>

      {source === "pesquisa" && (
        <div className="space-y-2 rounded-md border border-cyan-100 dark:border-cyan-900 bg-cyan-50/40 dark:bg-cyan-950/40 p-3">
          <p className="text-xs text-cyan-800 dark:text-cyan-200">Reutiliza o Price Research Workspace. Cole os itens (descrição;qtd;un;valor).</p>
          <textarea value={researchText} onChange={(e) => setResearchText(e.target.value)} rows={3} placeholder="Caneta;100;un;1,50"
            className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <button type="button" onClick={() => importResearch.mutate({ workspaceId, source: "colar", text: researchText })} disabled={importResearch.isPending || !researchText.trim()}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
            {importResearch.isPending ? "Importando…" : "Importar pesquisa"}
          </button>
          {importResearch.data && <p className="text-xs text-green-700 dark:text-green-300">{importResearch.data.itemCount} item(ns) importado(s).</p>}
        </div>
      )}

      <textarea value={justification} onChange={(e) => form.setField("justification", e.target.value)} rows={3} placeholder="Justificativa do preço de referência…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <label className="block text-xs font-medium text-foreground">Valor de referência (R$)
        <input type="number" step="0.01" min="0" value={form.values.referenceValue ?? ""} onChange={(e) => form.setField("referenceValue", e.target.value)}
          className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
        Confirmo que esta é a justificativa de preço institucional (registro oficial com meu nome como autor).
      </label>

      {save.isError && <p className="text-xs text-red-600 dark:text-red-400">{save.error.message}</p>}
      {save.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Justificativa do preço registrada.</p>}
      <button type="button" onClick={() => save.mutate({ workspaceId, source, justification: justification.trim(), referenceValue: value, researchId: researchId || current?.researchId || undefined, confirmOfficial: true })}
        disabled={!form.ready || !valid || !confirm || save.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {!form.ready ? "Carregando…" : save.isPending ? "Salvando…" : current ? "Registrar nova versão da justificativa do preço" : "Registrar justificativa do preço"}
      </button>
      {!valid && form.ready && <p className="text-[11px] text-muted-foreground">Informe a justificativa (ao menos {MIN_CHARS} caracteres) e um valor de referência maior que zero.</p>}
    </div>
  );
}
