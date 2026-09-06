import React from "react";
import { trpc } from "../../lib/trpc";
import NewDirectProcurementWizard from "./NewDirectProcurementWizard";
import DirectProcurementOverview from "./DirectProcurementOverview";
import LegalBasisWorkspace from "./LegalBasisWorkspace";
import NeedCharacterizationWorkspace from "./NeedCharacterizationWorkspace";
import ProposalCollectionWorkspace from "./ProposalCollectionWorkspace";
import ContractJustificationWorkspace from "./ContractJustificationWorkspace";
import PriceJustificationWorkspace from "./PriceJustificationWorkspace";
import RequiredDocumentsWorkspace from "./RequiredDocumentsWorkspace";
import RatificationWorkspace from "./RatificationWorkspace";
import PublicationWorkspace from "./PublicationWorkspace";
import TimelinePanel from "./TimelinePanel";
import { Section } from "@/components/ui/Section";
import { stageLabel, STAGE_CLASSES, PLATFORM_LABELS, RECEIPT_LABELS, PROCUREMENT_TYPE_LABELS } from "./labels";

/**
 * DirectProcurementHome — REAL (tRPC).
 *
 * Página raiz do Business Domain Contratação Direta. Conduz o servidor por
 * Dispensa/Inexigibilidade num Workspace próprio. O Adaptive Process Engine
 * define as etapas; o parecer jurídico é solicitado ao Business Domain Parecer
 * Jurídico via Institutional Request Engine (sem duplicação).
 */

type View = "list" | "new";

export default function DirectProcurementHome() {
  const [view, setView] = React.useState<View>("list");
  const [workspaceId, setWorkspaceId] = React.useState("");
  const utils = trpc.useUtils();

  const enabled = workspaceId.trim().length > 0;
  const { data, isLoading } = trpc.directProcurement.loadProcess.useQuery({ workspaceId }, { enabled });

  const configureProcedure = trpc.directProcurement.configureProcedure.useMutation({
    onSuccess: () => void utils.directProcurement.loadProcess.invalidate({ workspaceId }),
  });
  const requestOpinion = trpc.directProcurement.requestLegalOpinion.useMutation({
    onSuccess: () => void utils.directProcurement.loadProcess.invalidate({ workspaceId }),
  });

  const ws = data?.workspace;

  const open = (id: string) => { setWorkspaceId(id); setView("list"); };

  if (!enabled) {
    return (
      <div className="space-y-6">
        {/* Micro-Polish: sem título duplicado — "Contratação Direta" já vem do PageHeader
            canônico. Aqui fica só o contexto operacional (posicionamento + alternador). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">Dispensa e Inexigibilidade — workspace próprio, fluxo adaptativo.</p>
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            <button type="button" onClick={() => setView("list")} className={`rounded-md px-3 py-1 transition ${view === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Processos</button>
            <button type="button" onClick={() => setView("new")} className={`rounded-md px-3 py-1 transition ${view === "new" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Novo</button>
          </div>
        </div>
        {view === "new" ? <NewDirectProcurementWizard onCreated={open} /> : <DirectProcurementOverview onOpen={setWorkspaceId} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setWorkspaceId("")} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200">← Voltar aos processos</button>
        {ws && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_CLASSES[ws.currentStage] ?? STAGE_CLASSES.NEW}`}>{stageLabel(ws.currentStage)}</span>
        )}
      </header>

      {isLoading || !ws ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{ws.processNumber} — {PROCUREMENT_TYPE_LABELS[ws.procurementType] ?? ws.procurementType}</h2>
            <p className="text-xs text-muted-foreground">{ws.object}</p>
            <p className="mt-1 text-xs text-muted-foreground">Fundamento: {ws.legalBasis || "a definir"}</p>
          </div>

          {/* Fases institucionais do processo (agrupamento de NÍVEL 1) — reduz o efeito
              "vários formulários independentes" sem alterar componentes/mutações. */}
          <Section title="Fundamentação" description="Base legal, necessidade e justificativas.">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <LegalBasisWorkspace workspaceId={ws.id} procurementType={ws.procurementType as "dispensa" | "inexigibilidade"} currentBasis={ws.legalBasis} />
              <NeedCharacterizationWorkspace workspaceId={ws.id} />
              <ContractJustificationWorkspace workspaceId={ws.id} />
              <PriceJustificationWorkspace workspaceId={ws.id} />
            </div>
          </Section>

          <Section title="Condução e propostas" description="Forma de condução e, quando aplicável, recebimento das propostas.">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Procedimento (Forma de Condução) */}
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Forma de Condução</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => configureProcedure.mutate({ workspaceId: ws.id, procedureType: "eletronico", platform: "compras_gov" })}
                    className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-indigo-300">Eletrônico</button>
                  <button type="button" onClick={() => configureProcedure.mutate({ workspaceId: ws.id, procedureType: "presencial", receiptMethod: "protocolo" })}
                    className="flex-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-indigo-300">Presencial</button>
                </div>
                {data?.procedure && (
                  <p className="text-xs text-muted-foreground">
                    Atual: {data.procedure.procedureType}
                    {data.procedure.platform ? ` · ${PLATFORM_LABELS[data.procedure.platform] ?? data.procedure.platform}` : ""}
                    {data.procedure.receiptMethod ? ` · ${RECEIPT_LABELS[data.procedure.receiptMethod] ?? data.procedure.receiptMethod}` : ""}
                  </p>
                )}
              </div>
              {ws.flags.requiresProposalCollection && <ProposalCollectionWorkspace workspaceId={ws.id} proposals={data?.proposals ?? []} />}
            </div>
          </Section>

          <Section title="Parecer e documentação" description="Parecer jurídico (via Institutional Request Engine) e documentos obrigatórios.">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Parecer Jurídico via Institutional Request Engine */}
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Parecer Jurídico</h3>
                <p className="text-xs text-muted-foreground">Solicitado ao Business Domain Parecer Jurídico — sem duplicação.</p>
                <button type="button" onClick={() => requestOpinion.mutate({ workspaceId: ws.id })} disabled={requestOpinion.isPending}
                  className="w-full rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
                  {requestOpinion.isPending ? "Solicitando…" : "Solicitar parecer jurídico"}
                </button>
                {requestOpinion.data && <p className="text-xs text-green-700 dark:text-green-300">Solicitação {requestOpinion.data.requestId.slice(0, 8)}… enviada. Aguardando retorno automático.</p>}
              </div>
              <RequiredDocumentsWorkspace workspaceId={ws.id} documents={data?.requiredDocuments ?? []} />
            </div>
          </Section>

          <Section title="Encerramento" description="Ratificação e publicação do ato.">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <RatificationWorkspace workspaceId={ws.id} />
              <PublicationWorkspace workspaceId={ws.id} publications={data?.publications ?? []} />
            </div>
          </Section>

          <Section title="Linha do tempo" description="Sequência auditável de eventos do processo.">
            <TimelinePanel timeline={data?.timeline ?? []} />
          </Section>
        </>
      )}
    </div>
  );
}
