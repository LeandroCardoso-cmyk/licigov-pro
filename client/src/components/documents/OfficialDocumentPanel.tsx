import React from "react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";

/**
 * RC-3 / PR B.1 — OfficialDocumentPanel (experiência documental ÚNICA).
 *
 * Componente compartilhado por TODOS os Business Domains: lista os documentos
 * oficiais de uma origem (Document Engine) e oferece, idêntico em qualquer módulo:
 * Preview, Baixar DOCX, Baixar PDF e Imprimir — via o pipeline INSTITUCIONAL comum
 * (PR B.1): cabeçalho institucional, status/versão fiéis, sem artefatos Markdown,
 * nome de download legível. A impressão abre o PDF institucional (inline, sem chrome
 * da aplicação). Exportar é LEITURA — nunca altera status/versão. Tokens semânticos
 * (light/dark).
 */

export interface OfficialDocumentPanelProps {
  businessDomain: "processo_licitatorio" | "contratacao_direta" | "parecer_juridico" | "contratos";
  origin: string;
  title?: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  dfd: "DFD", etp: "ETP", tr: "TR", edital: "Edital",
  justificativa_contratacao: "Justificativa da Contratação", justificativa_preco: "Justificativa do Preço",
  ratificacao: "Ratificação", aviso: "Aviso", extrato_contrato: "Extrato de Contrato",
  parecer_inicial: "Parecer Inicial", parecer_final: "Parecer Final", despacho: "Despacho",
  contrato: "Contrato", aditivo: "Termo Aditivo", apostilamento: "Apostilamento", rescisao: "Rescisão", outro: "Documento",
};

export default function OfficialDocumentPanel({ businessDomain, origin, title = "Documentos Oficiais" }: OfficialDocumentPanelProps) {
  const enabled = origin.trim().length > 0;
  const { data, isLoading } = trpc.documentEngine.list.useQuery({ businessDomain, origin }, { enabled });
  const [previewId, setPreviewId] = React.useState<string>("");

  const exportDoc = trpc.documentEngine.exportInstitutional.useMutation({
    onSuccess: (res, vars) => {
      if (vars.inline) {
        // Impressão / visualização: abre o PDF institucional numa nova aba (sem chrome da app).
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        const a = document.createElement("a");
        a.href = res.url; a.download = res.fileName; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      }
    },
    onError: (e) => toast.error("Falha ao exportar: " + e.message),
  });
  const preview = trpc.documentEngine.preview.useQuery({ documentId: previewId }, { enabled: previewId.length > 0 });

  const busy = (documentId: string, action: "docx" | "pdf" | "print") =>
    exportDoc.isPending &&
    exportDoc.variables?.documentId === documentId &&
    (action === "print"
      ? exportDoc.variables?.inline === true
      : exportDoc.variables?.format === action && !exportDoc.variables?.inline);

  const documents = data?.documents ?? [];
  const btn = "rounded border border-input px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[11px] text-muted-foreground">Pipeline único · DOCX + PDF · versionado</span>
      </div>

      {!enabled ? (
        <p className="text-xs text-muted-foreground">Selecione um item para ver seus documentos oficiais.</p>
      ) : isLoading ? (
        <div className="h-14 animate-pulse rounded-md bg-muted" />
      ) : documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum documento oficial gerado ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((d) => (
            <li key={d.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium text-foreground">{d.title}</p>
                  <p className="text-xs text-muted-foreground">{DOC_TYPE_LABELS[d.documentType] ?? d.documentType} · v{d.version} · {d.status}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setPreviewId(previewId === d.id ? "" : d.id)} className={btn}>Preview</button>
                  <button type="button" onClick={() => exportDoc.mutate({ documentId: d.id, format: "docx" })} disabled={exportDoc.isPending} className={btn}>{busy(d.id, "docx") ? "…" : "DOCX"}</button>
                  <button type="button" onClick={() => exportDoc.mutate({ documentId: d.id, format: "pdf" })} disabled={exportDoc.isPending} className={btn}>{busy(d.id, "pdf") ? "…" : "PDF"}</button>
                  <button type="button" onClick={() => exportDoc.mutate({ documentId: d.id, format: "pdf", inline: true })} disabled={exportDoc.isPending} className={btn}>{busy(d.id, "print") ? "…" : "Imprimir"}</button>
                </div>
              </div>
              {previewId === d.id && (
                <div className="mt-2 rounded-md border border-border bg-muted/50 p-3">
                  {preview.isLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando prévia…</p>
                  ) : (
                    <>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">{preview.data?.document?.content ?? "Sem conteúdo."}</pre>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        replayHash: {preview.data?.document?.replayHash?.slice(0, 12)}… · template: {preview.data?.document?.template} · autor: {preview.data?.document?.author}
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
