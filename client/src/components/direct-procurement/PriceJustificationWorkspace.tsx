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
 *
 * R9 / SEM-042 — com fonte "pesquisa", o valor de referência é CALCULADO PELO SERVIDOR a partir das cotações da pesquisa
 * importada, pelo método que a pessoa escolhe (sem padrão); esta tela só o exibe e o envia como proposta (o servidor
 * recusa se divergir). Nenhuma "confiança"/"baseado na pesquisa" fixa: a origem registrada (pesquisa, hash, nº de
 * cotações, método) é mostrada como fato. Manual/documento: valor DECLARADO pela pessoa, sem pesquisa vinculada.
 */

export interface PriceJustificationWorkspaceProps {
  workspaceId: string;
}

type Source = "pesquisa" | "manual" | "documento";
type Method = "media" | "mediana" | "menor_preco";
const METHOD_LABELS: Record<Method, string> = { media: "Média", mediana: "Mediana", menor_preco: "Menor preço" };
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  const [method, setMethod] = React.useState<Method | "">("");
  const [confirm, setConfirm] = React.useState(false);
  const researches = persisted.data?.priceResearches ?? [];
  // Uma única pesquisa verificada ⇒ é ela; várias ⇒ a pessoa escolhe (o servidor também recusa a ambiguidade).
  const selected = researches.find((r) => r.researchId === (researchId || (researches.length === 1 ? researches[0].researchId : ""))) ?? null;
  const serverValue = selected && selected.consistent && selected.values && method ? selected.values[method] : null;

  // R2 / PR-04A — idempotencyKey por TENTATIVA LÓGICA de importação: gerada uma vez por submit e
  // preservada em erro (o retry do MESMO conteúdo reusa a key → o servidor converge, sem duplicar);
  // rotacionada no sucesso ou quando o conteúdo colado muda (nova importação ≠ mesma chave).
  const importKeyRef = React.useRef<string>("");
  const ensureImportKey = () => {
    if (!importKeyRef.current) importKeyRef.current = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "").slice(0, 48);
    return importKeyRef.current;
  };
  const importResearch = trpc.directProcurement.importPriceResearch.useMutation({
    onSuccess: (res) => {
      importKeyRef.current = ""; setResearchId(res.researchId);
      void utils.directProcurement.getJustifications.invalidate({ workspaceId });
    },
  });
  const save = trpc.directProcurement.generatePriceJustification.useMutation({
    onSuccess: () => { setConfirm(false); void utils.directProcurement.getJustifications.invalidate({ workspaceId }); },
  });

  const justification = form.values.justification ?? "";
  const declared = Number(form.values.referenceValue ?? "");
  const value = source === "pesquisa" ? (serverValue ?? 0) : declared;
  const valid = justification.trim().length >= MIN_CHARS && Number.isFinite(value) && value > 0 && (source !== "pesquisa" || (!!selected && !!method));

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
          <textarea value={researchText} onChange={(e) => { importKeyRef.current = ""; setResearchText(e.target.value); }} rows={3} placeholder="Caneta;100;un;1,50"
            className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          <button type="button" onClick={() => importResearch.mutate({ workspaceId, source: "colar", text: researchText, idempotencyKey: ensureImportKey() })} disabled={importResearch.isPending || !researchText.trim()}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
            {importResearch.isPending ? "Importando…" : "Importar pesquisa"}
          </button>
          {importResearch.isError && <p className="text-xs text-red-600 dark:text-red-400">{importResearch.error.message}</p>}
          {importResearch.data && <p className="text-xs text-green-700 dark:text-green-300">{importResearch.data.deduplicated
            ? `Conteúdo já importado anteriormente (${importResearch.data.itemCount} item(ns)) — nada foi duplicado.`
            : `${importResearch.data.itemCount} item(ns) importado(s).`}</p>}
          {researches.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma pesquisa importada neste processo: importe a pesquisa para que o sistema calcule o valor de referência.</p>
          ) : (
            <div className="space-y-2">
              {researches.length > 1 && (
                <label className="block text-xs font-medium text-foreground">Pesquisa que fundamenta o preço
                  <select value={selected?.researchId ?? ""} onChange={(e) => setResearchId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm">
                    <option value="">Selecione…</option>
                    {researches.map((r) => <option key={r.researchId} value={r.researchId}>{r.researchId} — {r.quoteCount} cotação(ões), importada em {r.importedAt.slice(0, 10)}</option>)}
                  </select>
                </label>
              )}
              {selected && !selected.consistent && <p className="text-xs text-red-600 dark:text-red-400">Esta pesquisa não permite calcular um valor ({selected.inconsistencyDetail}).</p>}
              {selected && selected.consistent && (
                <>
                  <p className="text-xs text-muted-foreground">Pesquisa {selected.researchId} · {selected.quoteCount} cotação(ões) em {selected.itemCount} item(ns) · conteúdo sha256 {selected.contentHash.slice(0, 12)}…{selected.minQuotesPerItem < 3 ? ` · menor nº de cotações por item: ${selected.minQuotesPerItem}` : ""}</p>
                  <label className="block text-xs font-medium text-foreground">Método de cálculo (escolha da pessoa — sem padrão)
                    <select value={method} onChange={(e) => setMethod(e.target.value as Method | "")} className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm">
                      <option value="">Selecione…</option>
                      {(Object.keys(METHOD_LABELS) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]} — {selected.values ? brl(selected.values[m]) : ""}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <textarea value={justification} onChange={(e) => form.setField("justification", e.target.value)} rows={3} placeholder="Justificativa do preço de referência…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      {source === "pesquisa" ? (
        <p className="text-xs font-medium text-foreground">Valor de referência calculado pelo sistema: {serverValue !== null ? brl(serverValue) : "— (selecione a pesquisa e o método)"}</p>
      ) : (
        <label className="block text-xs font-medium text-foreground">Valor de referência declarado (R$) — não verificado pelo sistema
          <input type="number" step="0.01" min="0" value={form.values.referenceValue ?? ""} onChange={(e) => form.setField("referenceValue", e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
      )}
      {current?.lineage && (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
          Origem do valor registrado: {current.lineage.kind === "pesquisa"
            ? `pesquisa ${current.lineage.researchId} (sha256 ${current.lineage.contentHash.slice(0, 12)}…), ${current.lineage.quoteCount} cotação(ões), método ${METHOD_LABELS[current.lineage.method]}, valor calculado pelo sistema ${brl(current.lineage.computedValue)}.`
            : `valor declarado pelo servidor (${brl(current.lineage.declaredValue)}), sem pesquisa vinculada.`}
        </p>
      )}
      {current && !current.lineage && <p className="text-[11px] text-muted-foreground">Registro anterior sem linhagem de origem registrada.</p>}
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
        Confirmo que esta é a justificativa de preço institucional (registro oficial com meu nome como autor).
      </label>

      {save.isError && <p className="text-xs text-red-600 dark:text-red-400">{save.error.message}</p>}
      {save.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Justificativa do preço registrada.</p>}
      <button type="button" onClick={() => save.mutate(source === "pesquisa" && selected && method
          ? { workspaceId, source, justification: justification.trim(), referenceValue: value, researchId: selected.researchId, method, confirmOfficial: true }
          : { workspaceId, source, justification: justification.trim(), referenceValue: value, confirmOfficial: true })}
        disabled={!form.ready || !valid || !confirm || save.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {!form.ready ? "Carregando…" : save.isPending ? "Salvando…" : current ? "Registrar nova versão da justificativa do preço" : "Registrar justificativa do preço"}
      </button>
      {!valid && form.ready && <p className="text-[11px] text-muted-foreground">Informe a justificativa (ao menos {MIN_CHARS} caracteres){source === "pesquisa" ? ", a pesquisa e o método de cálculo." : " e um valor de referência maior que zero."}</p>}
    </div>
  );
}
