import React from "react";
import { trpc } from "../../lib/trpc";
import { domainLabel, stageLabel, REQUEST_TYPE_LABELS, STAGE_CLASSES, PRIORITY_LABELS, PRIORITY_CLASSES, formatDate } from "./labels";

/**
 * InstitutionalInbox — REAL (tRPC).
 *
 * Caixa Institucional do Procurador. Mostra as solicitações que o Institutional
 * Request Engine encaminhou ao domínio parecer_juridico e os trabalhos já abertos.
 * O Procurador trabalha EXCLUSIVAMENTE aqui — nunca abre um Processo diretamente.
 */

export interface InstitutionalInboxProps {
  onOpenWorkspace?: (workspaceId: string) => void;
}

export default function InstitutionalInbox({ onOpenWorkspace }: InstitutionalInboxProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.legalOpinionWorkspace.listInbox.useQuery({});
  const receive = trpc.legalOpinionWorkspace.receiveRequest.useMutation({
    onSuccess: (res) => {
      void utils.legalOpinionWorkspace.listInbox.invalidate();
      onOpenWorkspace?.(res.workspace.id);
    },
  });

  const requests = data?.requests ?? [];
  const workspaces = data?.workspaces ?? [];

  return (
    <section className="rounded-xl border border-border bg-muted p-4">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-foreground">Caixa Institucional — Parecer Jurídico</h2>
        <p className="text-xs text-muted-foreground">Solicitações encaminhadas pelo Institutional Request Engine. Documentos referenciados, nunca copiados.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Pendências (a receber) */}
        <div className="rounded-lg bg-card/60 p-3">
          <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-foreground">
            Pendências
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-700">{isLoading ? "…" : requests.length}</span>
          </h3>
          <div className="space-y-3">
            {isLoading ? (
              <div className="h-16 animate-pulse rounded-md bg-muted" />
            ) : requests.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Nenhuma solicitação pendente.</p>
            ) : (
              requests.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-medium text-foreground">{r.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PRIORITY_CLASSES[r.priority] ?? PRIORITY_CLASSES.media}`}>
                      {PRIORITY_LABELS[r.priority] ?? r.priority}
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {domainLabel(r.sourceDomain)} · {REQUEST_TYPE_LABELS[r.requestType] ?? r.requestType} · {formatDate(r.createdAt)}
                  </p>
                  <button type="button" onClick={() => receive.mutate({ requestId: r.id })} disabled={receive.isPending}
                    className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
                    {receive.isPending ? "Abrindo…" : "Receber e abrir trabalho"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Trabalhos em andamento */}
        <div className="rounded-lg bg-card/60 p-3">
          <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-foreground">
            Em andamento
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">{isLoading ? "…" : workspaces.length}</span>
          </h3>
          <div className="space-y-3">
            {workspaces.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Nenhum trabalho aberto.</p>
            ) : (
              workspaces.map((w) => (
                <button key={w.id} type="button" onClick={() => onOpenWorkspace?.(w.id)}
                  className="w-full rounded-lg border border-border bg-card p-3 text-left transition hover:border-indigo-300">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{domainLabel(w.sourceDomain)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STAGE_CLASSES[w.currentStage] ?? STAGE_CLASSES.INBOX}`}>
                      {stageLabel(w.currentStage)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{REQUEST_TYPE_LABELS[w.requestType] ?? w.requestType}</p>
                  <p className="text-xs text-muted-foreground">Atualizado em {formatDate(w.updatedAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
