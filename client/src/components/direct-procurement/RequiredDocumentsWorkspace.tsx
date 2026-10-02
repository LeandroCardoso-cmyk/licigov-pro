import React from "react";
import { trpc } from "../../lib/trpc";
import { DOC_STATUS_LABELS, DOC_STATUS_CLASSES } from "./labels";

/**
 * RequiredDocumentsWorkspace — REAL (tRPC).
 *
 * Checklist dinâmico de documentação obrigatória (por modalidade/fundamento).
 * R7 / PR-16 (SEM-020): "Anexar" envia o ARQUIVO (upload S3 pelo servidor, com SHA-256) — nunca uma referência
 * digitada/fictícia; "Validar" só fica disponível para itens com anexo real.
 */

export interface RequiredDocumentsWorkspaceProps {
  workspaceId: string;
  documents?: Array<{ id: string; name: string; required: boolean; status: string; documentReference: string; contentHash?: string }>;
}

const hasEvidence = (d: { contentHash?: string }) => /^[0-9a-f]{64}$/.test(d.contentHash ?? "");

export default function RequiredDocumentsWorkspace({ workspaceId, documents = [] }: RequiredDocumentsWorkspaceProps) {
  const utils = trpc.useUtils();
  const refresh = () => void utils.directProcurement.loadProcess.invalidate({ workspaceId });
  const mutate = trpc.directProcurement.validateDocuments.useMutation({ onSuccess: refresh });
  const attach = trpc.directProcurement.attachRequiredDocument.useMutation({ onSuccess: refresh });
  const fileRefs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const setStatus = (documentId: string, status: "pendente" | "validado") => mutate.mutate({ workspaceId, documentId, status });
  const upload = (documentId: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const fileBase64 = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
      attach.mutate({ workspaceId, documentId, fileName: file.name, fileBase64, mimeType: file.type || "application/octet-stream" });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Documentação Obrigatória</h3>
        {documents.length === 0 && (
          <button type="button" onClick={() => mutate.mutate({ workspaceId })} disabled={mutate.isPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
            {mutate.isPending ? "Gerando…" : "Gerar checklist"}
          </button>
        )}
      </div>

      {mutate.isError && <p className="text-xs text-red-600 dark:text-red-400">{mutate.error.message}</p>}
      {attach.isError && <p className="text-xs text-red-600 dark:text-red-400">{attach.error.message}</p>}

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
                  <input type="file" className="hidden" ref={(el) => { fileRefs.current[d.id] = el; }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(d.id, f); e.target.value = ""; }} />
                  <button type="button" disabled={attach.isPending} onClick={() => fileRefs.current[d.id]?.click()} className="rounded bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-200 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">{hasEvidence(d) ? "Substituir arquivo" : "Anexar arquivo"}</button>
                  <button type="button" disabled={!hasEvidence(d) || mutate.isPending} title={hasEvidence(d) ? undefined : "Anexe o arquivo antes de validar"} onClick={() => setStatus(d.id, "validado")} className="rounded bg-green-100 dark:bg-green-900 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:text-green-200 hover:bg-green-200 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">Validar</button>
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
