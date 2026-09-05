import React from "react";
import { trpc } from "../../lib/trpc";
import ContractEditor from "./ContractEditor";
import AddendumWorkspace from "./AddendumWorkspace";
import ApostilleWorkspace from "./ApostilleWorkspace";
import OccurrenceWorkspace from "./OccurrenceWorkspace";
import DocumentsWorkspace from "./DocumentsWorkspace";
import TimelinePanel from "./TimelinePanel";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";
import { originLabel, statusLabel, STATUS_CLASSES } from "./labels";

/**
 * ContractWorkspace — REAL (tRPC).
 *
 * Workspace de um contrato, organizado em abas: Contrato, Aditivos, Apostilamentos,
 * Documentos e Ocorrências. O parecer jurídico é solicitado ao Business Domain
 * Parecer Jurídico via Institutional Request Engine (sem duplicação).
 */

export interface ContractWorkspaceProps {
  contractId: string;
  onBack?: () => void;
}

type Tab = "contrato" | "aditivos" | "apostilamentos" | "documentos" | "ocorrencias";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "contrato", label: "Contrato" },
  { key: "documentos", label: "Documentos" },
  { key: "aditivos", label: "Aditivos" },
  { key: "apostilamentos", label: "Apostilamentos" },
  { key: "ocorrencias", label: "Ocorrências" },
];

export default function ContractWorkspace({ contractId, onBack }: ContractWorkspaceProps) {
  const [tab, setTab] = React.useState<Tab>("contrato");
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.contractWorkspace.loadContract.useQuery({ contractId }, { enabled: contractId.length > 0 });
  const requestOpinion = trpc.contractWorkspace.requestLegalOpinion.useMutation({
    onSuccess: () => void utils.contractWorkspace.loadContract.invalidate({ contractId }),
  });

  const ws = data?.workspace;

  if (isLoading || !ws) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {onBack && <button type="button" onClick={onBack} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200">← Voltar aos contratos</button>}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{originLabel(ws.originType)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_CLASSES[ws.status] ?? STATUS_CLASSES.minuta}`}>{statusLabel(ws.status)}</span>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{ws.contractNumber} — {ws.contractor || "sem contratado"}</h2>
        <p className="line-clamp-1 text-xs text-muted-foreground">{ws.object}</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.5 text-xs font-medium">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`rounded-md px-3 py-1 transition ${tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "contrato" && (
        <div className="space-y-4">
          <ContractEditor contract={ws} />
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Parecer Jurídico</h3>
            <p className="mb-2 text-xs text-muted-foreground">Solicitado ao Business Domain Parecer Jurídico — sem duplicação.</p>
            <button type="button" onClick={() => requestOpinion.mutate({ contractId })} disabled={requestOpinion.isPending}
              className="w-full rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
              {requestOpinion.isPending ? "Solicitando…" : "Solicitar parecer jurídico"}
            </button>
            {requestOpinion.data && <p className="mt-1 text-xs text-green-700 dark:text-green-300">Solicitação {requestOpinion.data.requestId.slice(0, 8)}… enviada.</p>}
          </div>
        </div>
      )}
      {tab === "documentos" && (
        <div className="space-y-4">
          <DocumentsWorkspace contractId={contractId} documents={data?.documents ?? []} />
          <OfficialDocumentPanel businessDomain="contratos" origin={contractId} title="Documentos Oficiais (DOCX/PDF)" />
        </div>
      )}
      {tab === "aditivos" && <AddendumWorkspace contractId={contractId} addenda={data?.addenda ?? []} />}
      {tab === "apostilamentos" && <ApostilleWorkspace contractId={contractId} apostilles={data?.apostilles ?? []} />}
      {tab === "ocorrencias" && <OccurrenceWorkspace contractId={contractId} occurrences={data?.occurrences ?? []} />}

      <TimelinePanel timeline={data?.timeline ?? []} />
    </div>
  );
}
