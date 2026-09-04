import React from "react";
import { trpc } from "../../lib/trpc";
import { DOC_STATUS_LABELS, DOC_STATUS_CLASSES } from "./labels";

/**
 * RequiredDocumentsWorkspace — REAL (tRPC).
 *
 * Checklist dinâmico de documentação obrigatória (por modalidade/fundamento).
 * Permite anexar (referência), validar e pendenciar cada item.
 */

export interface RequiredDocumentsWorkspaceProps {
  workspaceId: string;
  documents?: Array<{ id: string; name: string; required: boolean; status: string; documentReference: string }>;
}

export default function RequiredDocumentsWorkspace({ workspaceId, documents = [] }: RequiredDocumentsWorkspaceProps) {
  const utils = trpc.useUtils();
  const mutate = trpc.directProcurement.validateDocuments.useMutation({
    onSuccess: () => void utils.directProcurement.loadProcess.invalidate({ workspaceId }),
  });

  const setStatus = (documentId: string, status: "pendente" | "anexado" | "validado") =>
    mutate.mutate({ workspaceId, documentId, status, documentReference: status === "anexado" ? "s3://anexo" : "" });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Documentação Obrigatória</h3>
        {documents.length === 0 && (
          <button type="button" onClick={() => mutate.mutate({ workspaceId })} disabled={mutate.isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {mutate.isPending ? "Gerando…" : "Gerar checklist"}
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Gere o checklist dinâmico conforme a modalidade.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm text-foreground">{d.name}{d.required && <span className="text-red-500"> *</span>}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${DOC_STATUS_CLASSES[d.status] ?? DOC_STATUS_CLASSES.pendente}`}>
                  {DOC_STATUS_LABELS[d.status] ?? d.status}
                </span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setStatus(d.id, "anexado")} className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-200">Anexar</button>
                  <button type="button" onClick={() => setStatus(d.id, "validado")} className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 hover:bg-green-200">Validar</button>
                  <button type="button" onClick={() => setStatus(d.id, "pendente")} className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted">Pendenciar</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
