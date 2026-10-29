import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";
import {
  deliverExport, EXPORT_TAB_BLOCKED_MESSAGE, exportDoneMessage, exportPlaceholderText, exportRequestFor,
  type ExportTab, type JourneyExportAction, type JourneyKind,
} from "@/lib/documentJourney";

/**
 * LICIGOV-FAST PR-1 — exportação individual na etapa (Visualizar / DOCX / PDF / Imprimir).
 *
 * Reusa o contrato canônico `procurementProcess.exportDocument` (mesmo RBAC, mesmo pipeline institucional,
 * mesma marcação de rascunho/emitido e o mesmo evento no histórico). Não gera nem regenera conteúdo: exporta o
 * que está salvo. Visualizar/Imprimir pedem o PDF `inline` e o abrem numa aba própria — só o documento, sem a
 * página de trabalho.
 */
export function useJourneyExport(processId: string) {
  const exportDoc = trpc.procurementProcess.exportDocument.useMutation();
  const [pending, setPending] = useState<{ kind: JourneyKind; action: JourneyExportAction } | null>(null);

  const run = async (kind: JourneyKind, action: JourneyExportAction) => {
    if (!processId || pending) return;
    const request = exportRequestFor(action);
    // A aba é aberta no próprio clique (gesto do usuário); a URL chega depois. Mostra o que está sendo preparado.
    let tab: Window | null = null;
    if (request.opensTab) {
      tab = window.open("", "_blank");
      if (tab) {
        try {
          tab.document.title = "LiciGov Pro — preparando PDF";
          tab.document.body.textContent = exportPlaceholderText(kind, action);
        } catch { /* aba sem acesso ao documento: segue só com o redirecionamento */ }
        tab.opener = null;
      }
    }
    setPending({ kind, action });
    try {
      const result = await exportDoc.mutateAsync({ processId, kind, format: request.format, disposition: request.disposition });
      const outcome = deliverExport(result, request, tab as ExportTab | null, {
        openTab: (url) => {
          const w = window.open(url, "_blank");
          if (w) w.opener = null;
          return w;
        },
        download: (url, fileName) => {
          const a = document.createElement("a");
          a.href = url; a.download = fileName; a.rel = "noopener";
          document.body.appendChild(a); a.click(); a.remove();
        },
      });
      if (outcome === "blocked") toast.error(EXPORT_TAB_BLOCKED_MESSAGE);
      else toast.success(exportDoneMessage(kind, action));
    } catch (e) {
      tab?.close();
      toast.error("Falha ao exportar: " + (e instanceof Error ? e.message : "erro desconhecido"));
    } finally {
      setPending(null);
    }
  };

  return { run, pending };
}
