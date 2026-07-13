import React from "react";
import { trpc } from "../../lib/trpc";
import CopilotPanel from "./CopilotPanel";
import { DOC_KIND_LABELS, formatDate } from "./labels";

/**
 * DocumentsWorkspace — REAL (tRPC).
 *
 * Geração inteligente de minutas (contrato/aditivo/apostilamento/rescisão) via
 * Document Engine + copilotos. Toda sugestão é revisável (CopilotPanel) — nunca
 * automática. Documentos organizados por referência, nunca duplicados.
 */

export interface DocumentsWorkspaceProps {
  contractId: string;
  documents?: Array<{ id: string; kind: string; title: string; createdAt: string }>;
}

const KINDS: Array<"contrato" | "aditivo" | "apostilamento" | "rescisao" | "anexo"> = ["contrato", "aditivo", "apostilamento", "rescisao"];

export default function DocumentsWorkspace({ contractId, documents = [] }: DocumentsWorkspaceProps) {
  const utils = trpc.useUtils();
  const generate = trpc.contractWorkspace.generateDocuments.useMutation({
    onSuccess: () => void utils.contractWorkspace.loadContract.invalidate({ contractId }),
  });
  const rec = generate.data?.recommendation ?? null;

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Documentos &amp; Minutas</h3>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => generate.mutate({ contractId, kind: k })} disabled={generate.isPending}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 disabled:opacity-50">
            Gerar {DOC_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {generate.isError && <p className="text-xs text-red-600">{generate.error.message}</p>}
      {(rec || generate.isPending) && <CopilotPanel recommendation={rec} busy={generate.isPending} />}

      {documents.length > 0 && (
        <ul className="divide-y divide-gray-50">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <div><p className="font-medium text-gray-800">{d.title}</p><p className="text-xs text-gray-400">{DOC_KIND_LABELS[d.kind] ?? d.kind}</p></div>
              <span className="text-[11px] text-gray-400">{formatDate(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
