import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ChevronRight,
  ArrowLeft,
  FileText,
  FileSearch,
  ListChecks,
  FileSignature,
  ScrollText,
  Gauge,
  X,
} from "lucide-react";
import ProcessoLicitatorioHome from "@/components/procurement/ProcessoLicitatorioHome";
import NovoProcessoWizard from "@/components/procurement/NovoProcessoWizard";
import ProcessOverview from "@/components/procurement/ProcessOverview";
import DFDWorkspace from "@/components/procurement/DFDWorkspace";
import PesquisaPrecosWorkspace from "@/components/procurement/PesquisaPrecosWorkspace";
import ItemIntelligenceWorkspace from "@/components/procurement/ItemIntelligenceWorkspace";
import ETPWorkspace from "@/components/procurement/ETPWorkspace";
import TRWorkspace from "@/components/procurement/TRWorkspace";
import EditalWorkspace from "@/components/procurement/EditalWorkspace";
import ProcurementItemPanel from "@/components/procurement/ProcurementItemPanel";

/**
 * PR B — Processo Licitatório (fluxo canônico, jornada única).
 *
 * Shell/orquestrador do pipeline canônico. Substitui o Dashboard legado na rota
 * `/processos`. Conduz o servidor pela jornada institucional sem URL manual:
 *
 *   Processo Licitatório → listagem → criar/abrir → DFD → ETP → TR → Edital
 *
 * DFD, ETP, TR e Edital NÃO são módulos: são ETAPAS INTERNAS deste processo,
 * expostas como abas do mesmo `processId`. Toda a navegação é por estado local
 * (nenhuma rota nova, nenhuma URL manual). Toda a persistência/regra vive no
 * backend (`procurementProcess.*`, tenantProcedure, fail-closed) — este shell
 * apenas compõe a experiência.
 */

type View = "list" | "new" | "process";

type StageTab =
  | "overview"
  | "dfd"
  | "price"
  | "items"
  | "etp"
  | "tr"
  | "edital";

const STAGE_TABS: { key: StageTab; label: string; icon: typeof FileText }[] = [
  { key: "overview", label: "Visão Geral", icon: Gauge },
  { key: "dfd", label: "DFD", icon: FileText },
  { key: "price", label: "Pesquisa de Preços", icon: FileSearch },
  { key: "items", label: "Itens Inteligentes", icon: ListChecks },
  { key: "etp", label: "ETP", icon: FileSignature },
  { key: "tr", label: "TR", icon: ScrollText },
  { key: "edital", label: "Edital", icon: FileSignature },
];

const STAGE_TAB_LABELS: Record<StageTab, string> = STAGE_TABS.reduce(
  (acc, t) => ({ ...acc, [t.key]: t.label }),
  {} as Record<StageTab, string>,
);

export default function ProcessoLicitatorio() {
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("list");
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StageTab>("overview");
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  // Cabeçalho/breadcrumb do processo aberto. Compartilha a query key de
  // `loadProcess` com o ProcessOverview (React Query deduplica), então não há
  // custo extra de rede.
  const processQuery = trpc.procurementProcess.loadProcess.useQuery(
    { processId: activeProcessId ?? "" },
    { enabled: view === "process" && !!activeProcessId },
  );
  const processNumber = processQuery.data?.process?.processNumber ?? null;

  /**
   * Após criar/atualizar um processo canônico, invalida a listagem E as consultas
   * da Central de Operações — assim o processo recém-criado aparece na Central
   * sem refresh manual (Escopo 3: "processos criados aparecem no Centro de
   * Operações"). A Central lê a MESMA fonte canônica (`procurementProcessesTable`).
   */
  function invalidateProcessSurfaces() {
    utils.procurementProcess.listProcesses.invalidate();
    utils.departmentOperation.dashboard.invalidate();
    utils.departmentOperation.indicators.invalidate();
    utils.departmentOperation.monitoringPanel.invalidate();
  }

  function openProcess(processId: string, tab: StageTab = "overview") {
    setActiveProcessId(processId);
    setActiveTab(tab);
    setOpenItemId(null);
    setView("process");
  }

  // Mapeia a forma de início escolhida no wizard para a etapa (aba) inicial —
  // assim "Criar/Importar DFD" abre no DFD e "Iniciar direto no ETP" abre no ETP.
  function tabForStartOption(startOption: string): StageTab {
    return startOption === "iniciar_etp" ? "etp" : "dfd";
  }

  function backToList() {
    setView("list");
    setActiveProcessId(null);
    setOpenItemId(null);
    invalidateProcessSurfaces();
  }

  // ── Listagem ────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="min-h-full bg-background">
        <ProcessoLicitatorioHome
          onCreateProcess={() => setView("new")}
          onOpenProcess={openProcess}
        />
      </div>
    );
  }

  // ── Novo processo ───────────────────────────────────────────────────────
  if (view === "new") {
    return (
      <div className="min-h-full bg-background">
        <div className="border-b border-border bg-card px-6 py-3">
          <Breadcrumb
            trail={[
              { label: "Processo Licitatório", onClick: () => setView("list") },
              { label: "Novo processo" },
            ]}
          />
        </div>
        <NovoProcessoWizard
          onCreated={(processId, startOption) => {
            invalidateProcessSurfaces();
            openProcess(processId, tabForStartOption(startOption));
          }}
        />
      </div>
    );
  }

  // ── Processo aberto (abas de etapa) ───────────────────────────────────────
  return (
    <div className="min-h-full bg-background">
      {/* Barra de contexto: breadcrumb + voltar */}
      <div className="border-b border-border bg-card px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <Breadcrumb
            trail={[
              { label: "Processo Licitatório", onClick: backToList },
              {
                label: processNumber ?? "Processo",
                onClick: () => setActiveTab("overview"),
              },
              { label: STAGE_TAB_LABELS[activeTab] },
            ]}
          />
          <button
            type="button"
            onClick={backToList}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar aos processos
          </button>
        </div>
      </div>

      {/* Abas de etapa (DFD → ETP → TR → Edital + apoio) */}
      <div className="border-b border-border bg-card">
        <nav
          className="flex gap-1 overflow-x-auto px-4"
          aria-label="Etapas do processo"
        >
          {STAGE_TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Conteúdo da etapa ativa */}
      <div>
        {activeProcessId && (
          <StagePanel
            tab={activeTab}
            processId={activeProcessId}
            onOpenItem={setOpenItemId}
          />
        )}
      </div>

      {/* Painel lateral de inteligência do item (drawer à direita) */}
      {openItemId && (
        <ItemDrawer itemId={openItemId} onClose={() => setOpenItemId(null)} />
      )}
    </div>
  );
}

function StagePanel({
  tab,
  processId,
  onOpenItem,
}: {
  tab: StageTab;
  processId: string;
  onOpenItem: (itemId: string) => void;
}) {
  switch (tab) {
    case "overview":
      return <ProcessOverview processId={processId} />;
    case "dfd":
      return <DFDWorkspace processId={processId} />;
    case "price":
      return <PesquisaPrecosWorkspace processId={processId} />;
    case "items":
      return (
        <ItemIntelligenceWorkspace
          processId={processId}
          onOpenItem={onOpenItem}
        />
      );
    case "etp":
      return <ETPWorkspace processId={processId} />;
    case "tr":
      return <TRWorkspace processId={processId} />;
    case "edital":
      return <EditalWorkspace processId={processId} />;
    default:
      return null;
  }
}

function ItemDrawer({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar painel do item"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">
            Inteligência do item
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ProcurementItemPanel itemId={itemId} onClose={onClose} />
      </div>
    </div>
  );
}

type Crumb = { label: string; onClick?: () => void };

function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="flex items-center gap-1 text-sm">
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {crumb.onClick && !isLast ? (
              <button
                type="button"
                onClick={crumb.onClick}
                className="rounded font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {crumb.label}
              </button>
            ) : (
              <span
                className={isLast ? "font-semibold text-foreground" : "text-muted-foreground"}
              >
                {crumb.label}
              </span>
            )}
            {!isLast && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
          </span>
        );
      })}
    </nav>
  );
}
