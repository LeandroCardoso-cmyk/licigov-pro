import React from "react";
import { toast } from "sonner";
import { trpc } from "../../lib/trpc";
import OperationalDashboard from "./OperationalDashboard";
import OperationalMonitoringPanel from "./OperationalMonitoringPanel";
import OperationalCalendar from "./OperationalCalendar";
import OperationalTimeline from "./OperationalTimeline";
import OperationalInbox from "./OperationalInbox";
import OperationalRecommendations from "./OperationalRecommendations";
import OperationRecordWizard from "./OperationRecordWizard";
import LegacyImportWizard from "./LegacyImportWizard";

/**
 * DepartmentOperationHome — REAL (tRPC via filhos).
 *
 * Centro de Operações do Departamento de Licitações — o último Business Domain
 * principal. Consolida, organiza, acompanha e recomenda; nunca cria licitações,
 * contratos ou pareceres. Substitui a planilha operacional por uma experiência
 * moderna, inteligente e integrada aos demais Business Domains.
 */

type Tab = "centro" | "painel" | "calendario" | "timeline" | "caixa" | "registros";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "centro", label: "Visão Geral" },
  { key: "painel", label: "Painel" },
  { key: "calendario", label: "Calendário" },
  { key: "caixa", label: "Minha Caixa" },
  { key: "timeline", label: "Timeline" },
  { key: "registros", label: "Registros" },
];

interface DepartmentOperationHomeProps {
  /**
   * Renderiza o cabeçalho interno (título + subtítulo + botão de relatório).
   * Quando o componente é embutido numa página que já provê o cabeçalho
   * institucional (ex.: Centro de Operações), passar `false` evita título
   * duplicado. Default `true` — preserva o comportamento standalone.
   */
  showPageHeader?: boolean;
}

export default function DepartmentOperationHome({ showPageHeader = true }: DepartmentOperationHomeProps) {
  const [tab, setTab] = React.useState<Tab>("centro");
  // PR B (Escopo 4) — o botão agora ENTREGA o relatório: antes a mutation era
  // disparada e o resultado descartado (botão sem comportamento visível). Faz o
  // download do conteúdo consolidado e sinaliza sucesso/erro em pt-BR.
  const generateReport = trpc.departmentOperation.generateReport.useMutation({
    onSuccess: (report) => {
      try {
        const blob = new Blob([report.content], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${report.title.replace(/[^a-zA-Z0-9_\-. ]/g, "_")}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast.success("Relatório operacional gerado.");
      } catch {
        toast.error("Não foi possível baixar o relatório.");
      }
    },
    onError: (e) => toast.error("Erro ao gerar o relatório: " + e.message),
  });

  const reportButton = (
    <button type="button" onClick={() => generateReport.mutate({ kind: "operacional" })} disabled={generateReport.isPending}
      className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50">
      {generateReport.isPending ? "Gerando…" : "Relatório Operacional"}
    </button>
  );

  return (
    <div className="space-y-6">
      {showPageHeader ? (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground">Centro de Operações</h1>
            <p className="text-xs text-muted-foreground">Como está o departamento agora? O que precisa da minha atenção?</p>
          </div>
          <div className="flex items-center gap-2">{reportButton}</div>
        </header>
      ) : (
        <div className="flex justify-end">{reportButton}</div>
      )}

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.5 text-xs font-medium">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-md px-3 py-1 transition ${tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "centro" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2"><OperationalDashboard /></div>
          <div><OperationalRecommendations /></div>
        </div>
      )}
      {tab === "painel" && <OperationalMonitoringPanel />}
      {tab === "calendario" && <OperationalCalendar />}
      {tab === "caixa" && <OperationalInbox />}
      {tab === "timeline" && <OperationalTimeline />}
      {tab === "registros" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <OperationRecordWizard />
          <LegacyImportWizard />
        </div>
      )}
    </div>
  );
}
