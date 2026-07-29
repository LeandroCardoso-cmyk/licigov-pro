import React from "react";
import { trpc } from "../../lib/trpc";
import { formatDate } from "./labels";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";

/**
 * PublicationWorkspace — REAL (tRPC).
 *
 * Geração das publicações conforme modalidade e procedimento (Document Engine
 * reutilizado): aviso, termo de ratificação, extrato de contrato e, no presencial,
 * instruções e cronograma.
 */

export interface PublicationWorkspaceProps {
  workspaceId: string;
  publications?: Array<{ id: string; kind: string; title: string; createdAt: string }>;
}

const KIND_LABELS: Record<string, string> = {
  aviso: "Aviso", ratificacao: "Termo de Ratificação", extrato_contrato: "Extrato de Contrato",
  instrucoes: "Instruções", cronograma: "Cronograma",
};

export default function PublicationWorkspace({ workspaceId, publications = [] }: PublicationWorkspaceProps) {
  const utils = trpc.useUtils();
  const publish = trpc.directProcurement.publish.useMutation({
    onSuccess: () => void utils.directProcurement.loadProcess.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Publicação</h3>
        <button type="button" onClick={() => publish.mutate({ workspaceId })} disabled={publish.isPending}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {publish.isPending ? "Gerando…" : "Gerar publicações"}
        </button>
      </div>

      {publish.isError && <p className="text-xs text-red-600">{publish.error.message}</p>}

      {publications.length === 0 ? (
        <p className="text-xs text-gray-400">Gere os documentos de publicação conforme a modalidade e o procedimento.</p>
      ) : (
        <ul className="space-y-2">
          {publications.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-gray-800">{p.title}</p>
                <p className="text-xs text-gray-500">{KIND_LABELS[p.kind] ?? p.kind}</p>
              </div>
              <span className="text-[11px] text-gray-400">{formatDate(p.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* PR B.1 — documentos oficiais persistidos (justificativa/ratificação/extrato/
          aviso) com Baixar DOCX/PDF + Imprimir institucional. LEITURA apenas — não
          dispara `publish`/geração. */}
      <OfficialDocumentPanel businessDomain="contratacao_direta" origin={workspaceId} title="Documentos Oficiais (DOCX/PDF)" />
    </div>
  );
}
