import React from "react";
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
  { key: "centro", label: "Centro de Operações" },
  { key: "painel", label: "Painel" },
  { key: "calendario", label: "Calendário" },
  { key: "caixa", label: "Minha Caixa" },
  { key: "timeline", label: "Timeline" },
  { key: "registros", label: "Registros" },
];

export default function DepartmentOperationHome() {
  const [tab, setTab] = React.useState<Tab>("centro");
  const generateReport = trpc.departmentOperation.generateReport.useMutation();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Centro de Operações</h1>
          <p className="text-xs text-gray-500">Como está o departamento agora? O que precisa da minha atenção?</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => generateReport.mutate({ kind: "operacional" })} disabled={generateReport.isPending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {generateReport.isPending ? "Gerando…" : "Relatório Operacional (DOCX/PDF)"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-md px-3 py-1 transition ${tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>{t.label}</button>
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
