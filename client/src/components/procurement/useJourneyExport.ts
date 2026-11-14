import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";
import { runJourneyExport, type JourneyExportAction, type JourneyKind } from "@/lib/documentJourney";

/**
 * LICIGOV-FAST PR-1 — exportação individual na etapa (Visualizar / DOCX / PDF / Imprimir).
 *
 * Reusa o contrato canônico `procurementProcess.exportDocument` (mesmo RBAC, mesmo pipeline institucional,
 * mesma marcação de rascunho/emitido e o mesmo evento no histórico). Não gera nem regenera conteúdo: exporta o
 * que está salvo. Visualizar/Imprimir pedem o PDF `inline` e o abrem numa aba própria — só o documento, sem a
 * página de trabalho. O fluxo (aba, entrega, erro) é a regra pura `runJourneyExport`.
 */
export function useJourneyExport(processId: string) {
  const exportDoc = trpc.procurementProcess.exportDocument.useMutation();
  const [pending, setPending] = useState<{ kind: JourneyKind; action: JourneyExportAction } | null>(null);

  const run = async (kind: JourneyKind, action: JourneyExportAction) => {
    if (!processId || pending) return;
    setPending({ kind, action });
    try {
      await runJourneyExport(kind, action, {
        exportDocument: (input) => exportDoc.mutateAsync({ processId, kind, ...input }),
        // A aba é aberta no próprio clique (gesto do usuário); a URL chega depois.
        openPlaceholderTab: (text) => {
          const tab = window.open("", "_blank");
          if (!tab) return null;
          try {
            tab.document.title = "LiciGov Pro — preparando PDF";
            tab.document.body.textContent = text;
          } catch { /* aba sem acesso ao documento: segue só com o redirecionamento */ }
          tab.opener = null;
          return tab;
        },
        delivery: {
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
        },
        notify: { success: (m) => toast.success(m), error: (m) => toast.error(m) },
      });
    } finally {
      setPending(null);
    }
  };

  return { run, pending };
}
