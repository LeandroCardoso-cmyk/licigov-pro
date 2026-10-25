import React from "react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";
import {
  actorLabel, DOCUMENT_KIND_LABELS, draftStatusLabel, formatDateTimeBR, latestOfficialSummary, modalityLabel,
  officialVersionLabel, stageLabel,
} from "../../lib/processDocumentStatus";

/**
 * ProcessOverview — REAL (wired to tRPC).
 *
 * UX: visão consolidada de um processo. Reúne cabeçalho, contagem de itens por
 * status, documentos gerados e eventos recentes. É a tela de leitura/revisão do
 * andamento — não um formulário.
 */

const PROCESS_STATUS_CLASSES: Record<string, string> = {
  rascunho: "bg-muted text-foreground",
  em_andamento: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  em_revisao: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
  emitido: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  arquivado: "bg-muted text-muted-foreground",
};

const ITEM_STATUS_META: { key: string; label: string; className: string }[] = [
  { key: "pendente", label: "Pendentes", className: "bg-muted text-foreground" },
  { key: "em_analise", label: "Em análise", className: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300" },
  { key: "aprovado", label: "Aprovados", className: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300" },
  { key: "rejeitado", label: "Rejeitados", className: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300" },
];

export type ProcessOverviewProps = {
  processId?: string;
};

const EXPORTABLE_KINDS = new Set(["dfd", "etp", "tr", "edital"]);

export default function ProcessOverview({
  processId = "",
}: ProcessOverviewProps) {
  const { data, isLoading } = trpc.procurementProcess.loadProcess.useQuery(
    { processId },
    { enabled: !!processId },
  );

  // Exportação DOCX/PDF via o núcleo comum (documentExportService) — abre a URL
  // assinada retornada. Reutilizável por outros módulos pelo mesmo padrão.
  const exportDoc = trpc.procurementProcess.exportDocument.useMutation({
    onSuccess: (r) => window.open(r.url, "_blank", "noopener,noreferrer"),
    onError: (e) => toast.error("Falha ao exportar: " + e.message),
  });

  if (!processId) {
    return (
      <div className="rounded-xl border border-dashed border-input bg-card p-8 text-center text-muted-foreground">
        Selecione um processo para ver o resumo.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-2">
        <div className="h-20 rounded-xl bg-muted" />
        <div className="h-24 rounded-xl bg-muted" />
        <div className="h-40 rounded-xl bg-muted" />
      </div>
    );
  }

  if (!data || !data.process) {
    return (
      <div className="rounded-xl border border-dashed border-input bg-card p-8 text-center text-muted-foreground">
        Processo não encontrado.
      </div>
    );
  }

  const { process, items, timeline, documents } = data;
  const officialVersions = data.officialVersions ?? {};
  const latestOfficial = latestOfficialSummary(officialVersions);
  const counts: Record<string, number> = {};
  for (const it of items) {
    counts[it.status] = (counts[it.status] ?? 0) + 1;
  }
  const recentTimeline = [...timeline]
    .sort((a, b) => b.order - a.order)
    .slice(0, 5);

  return (
    <div className="space-y-4 p-2">
      {/* Cabeçalho */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-semibold text-foreground">
              {process.processNumber}
            </p>
            <p className="mt-1 text-foreground">{process.object}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              PROCESS_STATUS_CLASSES[process.status] ??
              "bg-muted text-foreground"
            }`}
          >
            {process.status}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {latestOfficial && (
            <span className="rounded-md bg-green-100 dark:bg-green-900 px-2 py-1 font-medium text-green-700 dark:text-green-300">
              {latestOfficial}
            </span>
          )}
          <span
            className="rounded-md bg-indigo-50 dark:bg-indigo-950 px-2 py-1 text-indigo-700 dark:text-indigo-300"
            title="Marco administrativo registrado no processo. Não acompanha a elaboração dos documentos — veja a situação de cada documento abaixo."
          >
            Etapa registrada: {stageLabel(process.currentStage)}
          </span>
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
            Modalidade: {modalityLabel(process.modality)}
          </span>
          <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
            Assistentes de IA: {process.activeCopilots.length}
          </span>
        </div>
      </div>

      {/* Contagem de itens por status */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ITEM_STATUS_META.map((m) => (
          <div
            key={m.key}
            className="rounded-xl border border-border bg-card p-4 text-center"
          >
            <p className="text-2xl font-semibold text-foreground">
              {counts[m.key] ?? 0}
            </p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${m.className}`}
            >
              {m.label}
            </span>
          </div>
        ))}
      </div>

      {/* Documentos */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-semibold text-foreground">
          Documentos do processo
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Rascunho é o texto em elaboração; versão emitida é oficial e imutável. Exportar gera o arquivo e registra o evento.
        </p>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => {
              const exportable = EXPORTABLE_KINDS.has(d.kind);
              const busy = (fmt: "docx" | "pdf") =>
                exportDoc.isPending &&
                exportDoc.variables?.kind === d.kind &&
                exportDoc.variables?.format === fmt;
              return (
                <li key={d.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
                      {DOCUMENT_KIND_LABELS[d.kind] ?? d.kind}
                    </span>
                    <span className="text-sm text-foreground">{d.title}</span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    {officialVersionLabel(officialVersions, d.kind) && (
                      <span className="rounded-full bg-green-100 dark:bg-green-900 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                        {officialVersionLabel(officialVersions, d.kind)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">Rascunho: {draftStatusLabel(d.status).toLowerCase()}</span>
                    {exportable &&
                      (["docx", "pdf"] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() =>
                            exportDoc.mutate({ processId, kind: d.kind as "dfd" | "etp" | "tr" | "edital", format: fmt })
                          }
                          disabled={exportDoc.isPending}
                          className="rounded-md border border-input px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                        >
                          {busy(fmt) ? "..." : fmt.toUpperCase()}
                        </button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Eventos recentes */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold text-foreground">Eventos recentes</h2>
        {recentTimeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos.</p>
        ) : (
          <ul className="space-y-2">
            {recentTimeline.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                <div>
                  <p className="text-foreground">{e.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    {actorLabel(e.actorName, e.actor)} · {formatDateTimeBR(e.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
