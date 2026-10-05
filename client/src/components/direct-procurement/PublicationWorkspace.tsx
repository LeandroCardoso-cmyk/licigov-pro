import React from "react";
import { trpc } from "../../lib/trpc";
import { formatDate } from "./labels";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";

/**
 * PublicationWorkspace — REAL (tRPC).
 *
 * Geração das publicações conforme modalidade e procedimento (Document Engine
 * reutilizado): aviso, termo de ratificação e, no presencial, instruções e cronograma.
 * R9 / SEM-064 — o extrato de contrato só é gerado sob pedido e a partir de contrato REGISTRADO vinculado
 * (sem contrato, o servidor recusa e nada é gerado).
 */

export interface PublicationWorkspaceProps {
  workspaceId: string;
  /** `unbacked` (SEM-064): extrato gerado antes da correção, sem contrato registrado que o sustente. */
  publications?: Array<{ id: string; kind: string; title: string; createdAt: string; unbacked?: boolean }>;
}

const KIND_LABELS: Record<string, string> = {
  aviso: "Aviso", ratificacao: "Termo de Ratificação", extrato_contrato: "Extrato de Contrato",
  instrucoes: "Instruções", cronograma: "Cronograma",
};

export default function PublicationWorkspace({ workspaceId, publications = [] }: PublicationWorkspaceProps) {
  const utils = trpc.useUtils();
  const [includeExtract, setIncludeExtract] = React.useState(false);
  const publish = trpc.directProcurement.publish.useMutation({
    onSuccess: () => void utils.directProcurement.loadProcess.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Publicação</h3>
        <button type="button" onClick={() => publish.mutate({ workspaceId, includeContractExtract: includeExtract })} disabled={publish.isPending}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
          {publish.isPending ? "Gerando…" : "Gerar publicações"}
        </button>
      </div>

      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={includeExtract} onChange={(e) => setIncludeExtract(e.target.checked)} className="mt-0.5" />
        Incluir o extrato do contrato (exige contrato registrado e vinculado a esta contratação; sem contrato nada é gerado).
      </label>

      {publish.isError && <p className="text-xs text-red-600 dark:text-red-400">{publish.error.message}</p>}

      {publications.length === 0 ? (
        <p className="text-xs text-muted-foreground">Gere os documentos de publicação conforme a modalidade e o procedimento.</p>
      ) : (
        <ul className="space-y-2">
          {publications.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{p.title}</p>
                <p className="text-xs text-muted-foreground">{KIND_LABELS[p.kind] ?? p.kind}</p>
                {p.unbacked && <p className="text-xs text-red-600 dark:text-red-400">Sem contrato registrado que o sustente — não utilizar como extrato.</p>}
              </div>
              <span className="text-[11px] text-muted-foreground">{formatDate(p.createdAt)}</span>
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
