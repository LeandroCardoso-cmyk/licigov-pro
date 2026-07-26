import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * ProcessoLicitatorioHome — REAL (wired to tRPC).
 *
 * UX: esta é a porta de entrada do domínio Processo Licitatório.
 * A experiência é baseada em REVISÃO/validação, nunca em grandes formulários:
 * o operador escolhe um processo (card) e passa a validar recomendações do servidor.
 *
 * PR B: contraste dark mode via tokens semânticos (bg-card, text-foreground,
 * text-muted-foreground, border-border, bg-primary). Cores funcionais de status
 * (blue/amber/green) preservadas.
 */

const STAGE_LABELS: Record<string, string> = {
  NEW_PROCESS: "Novo Processo",
  DFD: "DFD",
  ETP: "ETP",
  PRICE_RESEARCH: "Pesquisa de Preços",
  ITEM_WORKSPACE: "Workspace de Itens",
  TR: "Termo de Referência",
  NOTICE: "Edital",
  REVIEW: "Revisão",
  ISSUED: "Emitido",
  ARCHIVED: "Arquivado",
};

const PROCESS_STATUS_CLASSES: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  em_andamento: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  em_revisao: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  emitido: "bg-green-500/15 text-green-600 dark:text-green-400",
  arquivado: "bg-muted text-muted-foreground",
};

const PROCESS_STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  em_andamento: "Em andamento",
  em_revisao: "Em revisão",
  emitido: "Emitido",
  arquivado: "Arquivado",
};

export type ProcessoLicitatorioHomeProps = {
  /** Callback ao clicar em "Novo Processo". */
  onCreateProcess?: () => void;
  /** Callback ao abrir um processo existente. */
  onOpenProcess?: (processId: string) => void;
};

export default function ProcessoLicitatorioHome({
  onCreateProcess,
  onOpenProcess,
}: ProcessoLicitatorioHomeProps) {
  const { data, isLoading } = trpc.procurementProcess.listProcesses.useQuery({
    limit: 50,
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Processos Licitatórios
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fluxo DFD → ETP → TR → Edital. Você valida recomendações; o sistema
            estrutura a contratação.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateProcess}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + Novo Processo
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-border bg-card p-5"
            >
              <div className="mb-3 h-4 w-24 rounded bg-muted" />
              <div className="mb-2 h-3 w-full rounded bg-muted" />
              <div className="mb-4 h-3 w-2/3 rounded bg-muted" />
              <div className="h-5 w-20 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      ) : !data || data.processes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-muted-foreground">Nenhum processo cadastrado ainda.</p>
          <button
            type="button"
            onClick={onCreateProcess}
            className="mt-3 text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Criar o primeiro processo
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {data.total} processo(s) encontrado(s)
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.processes.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProcess?.(p.id)}
                className="rounded-xl border border-border bg-card p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {p.processNumber}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      PROCESS_STATUS_CLASSES[p.status] ??
                      "bg-muted text-muted-foreground"
                    }`}
                  >
                    {PROCESS_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </div>
                <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
                  {p.object}
                </p>
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    {STAGE_LABELS[p.currentStage] ?? p.currentStage}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
