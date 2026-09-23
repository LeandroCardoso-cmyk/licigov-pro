import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { DocumentIngestionLauncher } from "@/components/ingestion/DocumentIngestionLauncher";
import { Spinner } from "@/components/ui/spinner";

/**
 * PesquisaPrecosWorkspace.
 *
 * B.2.2 — Ingestão canônica supervisionada (raw → staging → revisão humana) atrás da feature flag
 * tenant-aware `FF_CANONICAL_INGESTION` (fail-closed). Com a flag LIGADA, "colar conteúdo" e
 * "enviar arquivo" passam pela fundação canônica (upload multipart, fila, staging, revisão) e NÃO
 * gravam no domínio. A entrada "inserir manualmente" preserva o caminho legado (frozen). Com a flag
 * DESLIGADA (padrão de produção), a superfície canônica não é exposta e o comportamento legado
 * permanece idêntico.
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
 * Painel LEGADO (congelado) de importação de pesquisa de preços — extração direta em
 * "Itens Inteligentes" via procurementProcess.importPriceResearch. Mantido intacto: é a entrada
 * "manual" e o comportamento com a flag desligada.
 */
function LegacyPriceResearchPanel({ processId, onReviewItems }: { processId: string; onReviewItems?: () => void }) {
  const [source, setSource] = useState<ResearchSource>("colar");
  const [text, setText] = useState("");
  const importResearch = trpc.procurementProcess.importPriceResearch.useMutation();
  const items = importResearch.data?.intelligentItems ?? [];

  const handleImport = () => {
    if (!processId || !text.trim()) return;
    importResearch.mutate({ processId, source, text: text.trim() });
  };

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
        Esta entrada recebe texto, não arquivos. Ao importar, a pesquisa e os itens são registrados;
        depois, revise os Itens Inteligentes antes de aprová-los para uso no TR.
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
      <button
        type="button"
        onClick={handleImport}
        disabled={!processId || !text.trim() || importResearch.isPending}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
      >
        {importResearch.isPending ? "Processando..." : "Importar e gerar Itens Inteligentes"}
      </button>
      {!processId && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Selecione um processo para importar a pesquisa.
        </p>
      )}
      {importResearch.isError && (
        <p className="mt-2 text-sm text-destructive" role="alert">{importResearch.error.message || "Falha ao importar a pesquisa."}</p>
      )}
      {importResearch.isSuccess && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-3 text-sm font-medium text-green-700 dark:text-green-300">
            {importResearch.data?.research.itemCount ?? 0} cotação(ões) → {items.length} Item(ns) Inteligente(s)
            {importResearch.data?.materialization?.preserved ? ` (${importResearch.data.materialization.preserved} já decidido(s) preservado(s))` : ""}.
          </p>
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
                  CATMAT sugerido: {it.suggestedCATMAT ?? "—"}
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
  const { enabled, isLoading, error } = useIngestionCapabilities();

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Pesquisa de Preços</h1>
        <p className="text-sm text-muted-foreground">
          Organize as cotações da pesquisa e revise os Itens Inteligentes. Somente itens aprovados
          compõem a base de itens do TR.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Carregando…
        </div>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          Não foi possível consultar as opções de importação. Recarregue a página para tentar novamente.
        </p>
      ) : enabled ? (
        <DocumentIngestionLauncher
          importType="price_research"
          procurementProcessId={processId}
          importPurpose="price_research"
          title="Pesquisa de preços — ingestão supervisionada"
          description="Envie CSV, Excel (XLS/XLSX), PDF com texto ou DOCX, ou cole uma tabela. Revise as cotações antes da promoção à pesquisa. PDF escaneado exige OCR, ainda indisponível; arquivos .doc não são suportados."
          allowPaste
          onReviewItems={onReviewItems}
          manualSlot={<LegacyPriceResearchPanel processId={processId} onReviewItems={onReviewItems} />}
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
