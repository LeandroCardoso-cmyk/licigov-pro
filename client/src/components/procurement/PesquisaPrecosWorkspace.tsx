import BudgetDisclosureCard from "./BudgetDisclosureCard";
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { DocumentIngestionLauncher } from "@/components/ingestion/DocumentIngestionLauncher";
import { Spinner } from "@/components/ui/spinner";
import { formatCentsBRL } from "@shared/money";

/**
 * PesquisaPrecosWorkspace.
 *
 * B.2.2 — Ingestão canônica supervisionada (raw → staging → revisão humana) atrás da feature flag
 * tenant-aware `FF_CANONICAL_INGESTION` (fail-closed). Com a flag LIGADA há exatamente DUAS entradas,
 * ambas pela fundação canônica (fila, staging, revisão; nada grava direto no domínio): "Enviar arquivo"
 * (padrão; formatos reais do parserRegistry, PDF digitalizado via OCR governado) e "Colar texto".
 * U2B-MIN: o painel legado (gravação direta em Itens Inteligentes) NÃO é oferecido com a flag ligada.
 * Com a flag DESLIGADA, o painel legado permanece. PR-04 (SEM-005): falha ao consultar a capacidade NÃO cai no
 * caminho legado (a flag pode estar ligada — o servidor recusaria); a tela oferece "Tentar novamente".
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
  /** P0 piloto — CTA "Revisar Itens Inteligentes" após a promoção/importação. */
  onReviewItems?: () => void;
};

/**
 * Painel LEGADO de importação de pesquisa de preços — extração direta em "Itens Inteligentes" via
 * procurementProcess.importPriceResearch (entrada "manual" e comportamento com a flag desligada).
 * M8-PRICE-IMPORT-001: dois passos — "Conferir extração" (prévia sem gravação) → "Importar".
 */
const KIND_LABELS: Record<string, string> = {
  header: "cabeçalho", metadata: "dado do documento", summary: "resumo declarado", note: "observação/aviso", unrecognized: "não reconhecida",
};

function LegacyPriceResearchPanel({ processId, onReviewItems }: { processId: string; onReviewItems?: () => void }) {
  const [source, setSource] = useState<ResearchSource>("colar");
  const [text, setText] = useState("");
  // M8-PRICE-IMPORT-001: conferir a extração (sem gravar) ANTES de importar — itens, cotações, linhas ignoradas e pendências.
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const preview = trpc.procurementProcess.previewPriceResearch.useMutation();
  const importResearch = trpc.procurementProcess.importPriceResearch.useMutation();
  const items = importResearch.data?.intelligentItems ?? [];
  const p = preview.data;
  const previewCurrent = checkedText !== null && checkedText === text.trim() && !!p;

  const handlePreview = () => {
    if (!processId || !text.trim()) return;
    const t = text.trim();
    importResearch.reset();
    preview.mutate({ processId, text: t }, { onSuccess: () => setCheckedText(t) });
  };
  const handleImport = (confirmReplace = false) => {
    if (!processId || !previewCurrent || !p?.canImport) return;
    importResearch.mutate({ processId, source, text: text.trim(), ...(confirmReplace ? { confirmReplace: true } : {}) });
  };
  // PR-04 (SEM-005): o servidor recusou porque a importação substituiria cotações já registradas — nada foi gravado.
  const needsReplaceConfirmation = importResearch.isError
    && (importResearch.error?.message ?? "").startsWith("QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <label className="mb-3 flex flex-col text-sm sm:max-w-xs">
        <span className="mb-1 font-medium text-foreground">Origem do conteúdo colado</span>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as ResearchSource)}
          className="rounded-lg border border-input px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
        >
          {(Object.keys(SOURCE_LABELS) as ResearchSource[]).map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </label>
      <p className="mb-3 text-xs text-muted-foreground">
        Cole a pesquisa como está (blocos "Item 1 — descrição", "Quantidade: 10", "Fornecedor — R$ 3.900,00") ou uma
        planilha (descrição; quantidade; unidade; valor; fornecedor). Confira a extração antes de importar; depois,
        revise os Itens Inteligentes antes de aprová-los para uso no TR.
      </p>
      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-foreground">Conteúdo da pesquisa</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Cole aqui as cotações / itens da pesquisa de preços..."
          className="rounded-lg border border-input px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!processId || !text.trim() || preview.isPending}
          className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {preview.isPending ? "Conferindo..." : "Conferir extração"}
        </button>
        <button
          type="button"
          onClick={() => handleImport()}
          disabled={!processId || !previewCurrent || !p?.canImport || importResearch.isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {importResearch.isPending ? "Processando..." : "Importar e gerar Itens Inteligentes"}
        </button>
      </div>
      {!processId && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Selecione um processo para importar a pesquisa.
        </p>
      )}
      {preview.isError && (
        <p className="mt-2 text-sm text-destructive" role="alert">{preview.error.message || "Falha ao conferir a pesquisa."}</p>
      )}
      {p && checkedText !== null && !previewCurrent && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">O texto mudou desde a conferência — confira novamente antes de importar.</p>
      )}
      {p && previewCurrent && !importResearch.isSuccess && (
        <div className="mt-4 space-y-3 border-t border-border pt-4" data-testid="price-research-preview">
          <p className="text-sm font-medium text-foreground">
            Extração: {p.items.length} item(ns) · {p.quoteCount} cotação(ões) · {p.ignored.length} linha(s) ignorada(s)
          </p>
          {p.synthetic && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              Fonte declarada fictícia/demonstrativa: estas cotações ficam registradas como fictícias e não fundamentam preço de
              referência nem documento oficial (só homologação sintética autorizada).
            </p>
          )}
          {!p.synthetic && p.suspected && (
            <p data-testid="price-research-suspected" className="rounded-md border border-amber-300 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:text-amber-200">
              Possíveis dados demonstrativos (termos como "teste", "exemplo" ou "homologação"): confira a fonte. Sem declaração
              explícita, as cotações são registradas como declaradas — nunca como fictícias nem como verificadas.
            </p>
          )}
          {p.blocking.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive">
              <p className="mb-1 font-medium">Ambiguidades — nada será importado até corrigir o texto:</p>
              <ul className="list-disc pl-4">{p.blocking.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
            </div>
          )}
          <ul className="space-y-2">
            {p.items.map((it, i) => (
              <li key={i} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-foreground">{it.description}</p>
                {it.specification && <p className="text-xs text-muted-foreground">{it.specification}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Quantidade: {it.quantity ?? "não informada"} {it.unit} · Média: {it.averageCents !== null ? formatCentsBRL(it.averageCents) : "—"}
                  {" "}· Total estimado: {it.totalCents !== null ? formatCentsBRL(it.totalCents) : "—"}
                </p>
                <ul className="mt-1 text-xs text-foreground">
                  {it.quotes.map((q) => (
                    <li key={q.line}>
                      Linha {q.line}: {q.supplier || "fornecedor não informado"} — {q.valueCents !== null ? formatCentsBRL(q.valueCents) : "sem preço"}
                      {q.date ? ` — ${q.date}` : ""}{q.fictitious ? " (fonte fictícia)" : q.suspected ? " (possivelmente demonstrativa — confira)" : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {p.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-amber-700 dark:text-amber-300">{p.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
          )}
          {p.ignored.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Linhas ignoradas (não viram item nem cotação)</summary>
              <ul className="mt-1 space-y-0.5">{p.ignored.map((l) => <li key={l.line}>Linha {l.line} ({KIND_LABELS[l.kind] ?? l.kind}): {l.text}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      {importResearch.isError && !needsReplaceConfirmation && (
        <p className="mt-2 text-sm text-destructive" role="alert">{importResearch.error.message || "Falha ao importar a pesquisa."}</p>
      )}
      {needsReplaceConfirmation && (
        <div role="alert" data-testid="quote-replace-confirmation" className="mt-3 rounded-md border border-amber-400 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:text-amber-200">
          <p className="mb-2">{importResearch.error!.message.replace(/^QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED:\s*/, "")}</p>
          <button
            type="button"
            onClick={() => handleImport(true)}
            disabled={importResearch.isPending}
            className="rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-60 dark:hover:bg-amber-950"
          >
            Substituir as cotações anteriores
          </button>
        </div>
      )}
      {importResearch.isSuccess && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-3 text-sm font-medium text-green-700 dark:text-green-300">
            {importResearch.data?.research.itemCount ?? 0} cotação(ões) → {items.length} Item(ns) Inteligente(s)
            {importResearch.data?.materialization?.preserved ? ` (${importResearch.data.materialization.preserved} já decidido(s) preservado(s))` : ""}.
          </p>
          {importResearch.data?.synthetic && (
            <p role="status" data-testid="import-synthetic-warning" className="mb-3 rounded border border-amber-400 p-2 text-xs text-amber-800 dark:border-amber-700 dark:text-amber-300">
              Dados fictícios/sintéticos detectados: os valores são demonstrativos e não constituem pesquisa de preços válida.
            </p>
          )}
          {onReviewItems && (
            <button type="button" onClick={onReviewItems} className="mb-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              Revisar Itens Inteligentes
            </button>
          )}
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-foreground">{it.description}</span>
                <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  CATMAT/CATSER: {it.suggestedCATMAT ?? "pendente (buscar classificação)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PesquisaPrecosWorkspace({ processId = "", onReviewItems }: PesquisaPrecosWorkspaceProps) {
  const { enabled, isLoading, error, isFetching, refetch } = useIngestionCapabilities();

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Pesquisa de Preços</h1>
        <p className="text-sm text-muted-foreground">
          Organize as cotações da pesquisa e revise os Itens Inteligentes. Somente itens aprovados
          compõem a base de itens do TR.
        </p>
      </div>

      {processId && <BudgetDisclosureCard processId={processId} />}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Carregando…
        </div>
      ) : error ? (
        // Falha ao consultar capabilities: FAIL-CLOSED para as DUAS entradas (PR-04 / SEM-005). Sem saber se a
        // ingestão canônica está ligada, nem o launcher nem o painel legado (gravação direta) são oferecidos.
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          <p>
            Não foi possível consultar as opções de importação da pesquisa de preços. Nada foi importado; tente novamente
            em instantes.
          </p>
          <button
            type="button"
            onClick={() => { void refetch(); }}
            disabled={isFetching}
            className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
          >
            {isFetching ? "Consultando..." : "Tentar novamente"}
          </button>
        </div>
      ) : enabled ? (
        <DocumentIngestionLauncher
          importType="price_research"
          procurementProcessId={processId}
          importPurpose="price_research"
          title="Pesquisa de preços — ingestão supervisionada"
          description="Envie a planilha (XLSX, XLS ou CSV), o PDF — com texto ou digitalizado — ou o DOCX com a tabela de cotações. PDF digitalizado é lido por reconhecimento de texto (OCR): confira cada valor. Todas as cotações passam por revisão antes da promoção à pesquisa."
          allowPaste
          onReviewItems={onReviewItems}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A importação por arquivo não está habilitada para esta organização. A entrada por texto está disponível abaixo.
          </p>
          <LegacyPriceResearchPanel processId={processId} onReviewItems={onReviewItems} />
        </div>
      )}
    </div>
  );
}
