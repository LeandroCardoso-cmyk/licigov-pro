import React from "react";
import { ArrowLeft } from "lucide-react";
import { trpc } from "../../lib/trpc";
import InstitutionalInbox from "./InstitutionalInbox";
import LawyerDashboard from "./LawyerDashboard";
import RequestContextPanel from "./RequestContextPanel";
import LegalOpinionEditor from "./LegalOpinionEditor";
import LegalOpinionViewer from "./LegalOpinionViewer";
import SignaturePanel from "./SignaturePanel";
import TimelinePanel from "./TimelinePanel";
import OpinionHistory from "./OpinionHistory";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";
import { stageLabel, STAGE_CLASSES } from "./labels";
import { reasoningQueryEnabled, reasoningViewState } from "./legalOpinionQueryOrchestration";

/**
 * LegalOpinionHome — REAL (tRPC).
 *
 * Página raiz do Business Domain Parecer Jurídico. O Procurador trabalha
 * EXCLUSIVAMENTE aqui: escolhe uma solicitação na Caixa Institucional, o sistema
 * carrega automaticamente todo o contexto, e ele elabora → assina → devolve. A
 * resposta retorna sozinha à origem via Institutional Request Engine.
 */

type Tab = "inbox" | "dashboard";

export default function LegalOpinionHome() {
  const [tab, setTab] = React.useState<Tab>("inbox");
  const [workspaceId, setWorkspaceId] = React.useState<string>("");

  const enabled = workspaceId.trim().length > 0;
  // Conteúdo OPERACIONAL (documentos, timeline, rascunho) — leitura de banco, abre rápido.
  const { data: ctx, isLoading } = trpc.legalOpinionWorkspace.loadContext.useQuery(
    { workspaceId },
    { enabled },
  );
  // Reasoning & Explainability (APOIO) — Copiloto Jurídico (Kernel → RAG/LLM). Consulta
  // SEPARADA e progressiva. Só habilita APÓS o SUCCESS de loadContext: com o
  // `httpBatchLink` global, habilitar junto agruparia as duas na MESMA requisição HTTP e a
  // resposta operacional ficaria refém do LLM. Adiar a habilitação força uma 2ª requisição,
  // fora do batch inicial — sem tocar no transporte global.
  const reasoningEnabled = reasoningQueryEnabled({ workspaceSelected: enabled, contextLoaded: Boolean(ctx) });
  const {
    data: reasoning, isFetching: reasoningFetching, isError: reasoningIsError, refetch: refetchReasoning,
  } = trpc.legalOpinionWorkspace.loadReasoning.useQuery(
    { workspaceId },
    { enabled: reasoningEnabled },
  );
  const reasoningState = reasoningViewState({
    enabled: reasoningEnabled, isFetching: reasoningFetching, isError: reasoningIsError, hasData: Boolean(reasoning),
  });

  const stage = ctx?.workspace?.currentStage ?? "INBOX";
  const hasDraft = Boolean(ctx?.draft);
  const signed = Boolean(ctx?.draft?.signed);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Parecer Jurídico</h1>
          <p className="text-xs text-muted-foreground">Camada institucional operacional do jurídico — trabalho exclusivo na Caixa Institucional.</p>
        </div>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          <button type="button" onClick={() => setTab("inbox")}
            className={`rounded-md px-3 py-1 transition ${tab === "inbox" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Caixa</button>
          <button type="button" onClick={() => setTab("dashboard")}
            className={`rounded-md px-3 py-1 transition ${tab === "dashboard" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Painel</button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Coluna esquerda: caixa / painel */}
        <div className="lg:col-span-2">
          {tab === "inbox"
            ? <InstitutionalInbox onOpenWorkspace={setWorkspaceId} />
            : <LawyerDashboard onOpenWorkspace={setWorkspaceId} />}
        </div>

        {/* Coluna direita: trabalho sobre o parecer selecionado */}
        <div className="space-y-5 lg:col-span-3">
          {!enabled ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Selecione uma solicitação na Caixa Institucional para começar.
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
              <div className="h-40 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : (
            <>
              {/* V1 UI/UX Stabilization — afordância explícita de retorno à Caixa: antes só
                  se saía do trabalho ao concluir a assinatura (onReturned). Limpa o
                  workspace selecionado sem mutação e sem reload. */}
              <button
                type="button"
                onClick={() => setWorkspaceId("")}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar à caixa
              </button>

              <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Trabalho {workspaceId.slice(0, 8)}…</p>
                  <p className="text-xs text-muted-foreground">Processo ref.: {ctx?.workspace?.referenceProcessId || "—"}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STAGE_CLASSES[stage] ?? STAGE_CLASSES.INBOX}`}>
                  {stageLabel(stage)}
                </span>
              </div>

              <RequestContextPanel
                documents={ctx?.documents ?? []}
                reasoning={reasoning?.reasoning}
                explainability={reasoning?.explainability}
                risks={reasoning?.risks ?? []}
                recommendations={reasoning?.recommendations ?? []}
                snapshots={ctx?.snapshots ?? []}
                confidence={reasoning?.confidence ?? 0}
                reasoningState={reasoningState}
                onRetryReasoning={() => { void refetchReasoning(); }}
              />

              <LegalOpinionEditor workspaceId={workspaceId} hasDraft={hasDraft} />
              {hasDraft && <LegalOpinionViewer draft={ctx?.draft ?? null} />}
              <SignaturePanel workspaceId={workspaceId} signed={signed} onReturned={() => setWorkspaceId("")} />

              {/* V1 — superfície de Documentos Oficiais do Parecer. A exportação institucional
                  (DOCX/PDF) só é oferecida para a versão ASSINADA/emitido (policy server-owned:
                  parecer_juridico → "emitido"); rascunhos aparecem como histórico/preview mas não
                  exportam como parecer oficial. */}
              <OfficialDocumentPanel
                businessDomain="parecer_juridico"
                origin={workspaceId}
                requireStatusForExport="emitido"
                title="Documentos Oficiais do Parecer (DOCX/PDF)"
              />

              <TimelinePanel timeline={ctx?.timeline ?? []} />
              <OpinionHistory history={ctx?.history ?? []} versions={ctx?.versions ?? []} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
