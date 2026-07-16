import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * RC-3 — OfficialDocumentPanel (experiência documental ÚNICA).
 *
 * Componente compartilhado por TODOS os Business Domains: lista os documentos
 * oficiais de uma origem (via Document Engine) e oferece, de forma idêntica em
 * qualquer módulo: Preview, Download DOCX, Download PDF, Versões e Informações.
 * Nenhuma experiência diferente entre módulos.
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

function downloadBase64(base64: string, filename: string, format: "docx" | "pdf") {
  const mime = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function OfficialDocumentPanel({ businessDomain, origin, title = "Documentos Oficiais" }: OfficialDocumentPanelProps) {
  const enabled = origin.trim().length > 0;
  const { data, isLoading } = trpc.documentEngine.list.useQuery({ businessDomain, origin }, { enabled });
  const [previewId, setPreviewId] = React.useState<string>("");

  const download = trpc.documentEngine.download.useMutation({
    onSuccess: (res) => downloadBase64(res.base64, res.filename, res.format),
  });
  const preview = trpc.documentEngine.preview.useQuery({ documentId: previewId }, { enabled: previewId.length > 0 });

  const documents = data?.documents ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-[11px] text-gray-400">Pipeline único · DOCX + PDF · versionado</span>
      </div>

      {!enabled ? (
        <p className="text-xs text-gray-400">Selecione um processo para ver seus documentos oficiais.</p>
      ) : isLoading ? (
        <div className="h-14 animate-pulse rounded-md bg-gray-100" />
      ) : documents.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum documento oficial gerado ainda.</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {documents.map((d) => (
            <li key={d.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm font-medium text-gray-800">{d.title}</p>
                  <p className="text-xs text-gray-400">{DOC_TYPE_LABELS[d.documentType] ?? d.documentType} · v{d.version} · {d.status}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setPreviewId(previewId === d.id ? "" : d.id)} className="rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-200">Preview</button>
                  <button type="button" onClick={() => download.mutate({ documentId: d.id, format: "docx" })} disabled={download.isPending} className="rounded bg-blue-100 px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-200 disabled:opacity-50">DOCX</button>
                  <button type="button" onClick={() => download.mutate({ documentId: d.id, format: "pdf" })} disabled={download.isPending} className="rounded bg-red-100 px-2 py-1 text-[11px] font-medium text-red-800 hover:bg-red-200 disabled:opacity-50">PDF</button>
                </div>
              </div>
              {previewId === d.id && (
                <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                  {preview.isLoading ? (
                    <p className="text-xs text-gray-400">Carregando prévia…</p>
                  ) : (
                    <>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-700">{preview.data?.document?.content ?? "Sem conteúdo."}</pre>
                      <p className="mt-2 text-[11px] text-gray-400">
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
      {download.isError && <p className="text-xs text-red-600">{download.error.message}</p>}
    </div>
  );
}
