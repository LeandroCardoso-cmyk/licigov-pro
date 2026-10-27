import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  ChevronRight,
  ArrowLeft,
  FileText,
  FileSearch,
  ListChecks,
  ListOrdered,
  FileSignature,
  ScrollText,
  Gauge,
} from "lucide-react";
import ProcessoLicitatorioHome from "@/components/procurement/ProcessoLicitatorioHome";
import NovoProcessoWizard from "@/components/procurement/NovoProcessoWizard";
import ProcessOverview from "@/components/procurement/ProcessOverview";
import DFDWorkspace from "@/components/procurement/DFDWorkspace";
import PesquisaPrecosWorkspace from "@/components/procurement/PesquisaPrecosWorkspace";
import ItemIntelligenceWorkspace from "@/components/procurement/ItemIntelligenceWorkspace";
import ProcurementItemsWorkspace from "@/components/procurement/ProcurementItemsWorkspace";
import ETPWorkspace from "@/components/procurement/ETPWorkspace";
import TRWorkspace from "@/components/procurement/TRWorkspace";
import EditalWorkspace from "@/components/procurement/EditalWorkspace";
import ProcurementItemPanel, { ITEM_PANEL_TITLE_ID } from "@/components/procurement/ProcurementItemPanel";
import { processIdFromSearch, processRouteSearch, tabFromSearch } from "@shared/operationalCalendar";
import { startTargetFor } from "@/components/procurement/startOptions";

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
  | "contract_items"
  | "items"
  | "etp"
  | "tr"
  | "edital";

const STAGE_TABS: { key: StageTab; label: string; icon: typeof FileText }[] = [
  { key: "overview", label: "Visão Geral", icon: Gauge },
  { key: "dfd", label: "DFD", icon: FileText },
  { key: "price", label: "Pesquisa de Preços", icon: FileSearch },
  // Área transversal: disponível qualquer que seja a etapa em que o processo começou.
  { key: "contract_items", label: "Itens da contratação", icon: ListOrdered },
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
  // Aba cuja importação documental abre expandida (processo iniciado por "Importar DFD/ETP/TR").
  const [importOpenFor, setImportOpenFor] = useState<StageTab | null>(null);

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

  // Link direto (ex.: evento do Calendário Operacional) e RELOAD: `/processos?processId=…&tab=…` reabre o processo e a aba; o
  // servidor valida o acesso (processo de outra organização ⇒ `process: null` ⇒ volta à lista, abaixo).
  useEffect(() => {
    const id = typeof window !== "undefined" ? processIdFromSearch(window.location.search) : null;
    if (!id) return;
    openProcess(id, tabFromSearch(window.location.search, STAGE_TABS.map((t) => t.key)) ?? "overview");
  }, []);

  // M8 — a URL acompanha o processo e a aba abertos (replaceState: sem nova entrada no histórico; voltar/ESC inalterados).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = view === "process" && activeProcessId ? `${window.location.pathname}${processRouteSearch(activeProcessId, activeTab)}` : window.location.pathname;
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.replaceState(window.history.state, "", target);
  }, [view, activeProcessId, activeTab]);

  // Processo inexistente ou de outra organização (link antigo/editado): não fica numa tela vazia.
  const [notFoundNotice, setNotFoundNotice] = useState(false);
  useEffect(() => {
    if (view === "process" && activeProcessId && processQuery.isSuccess && !processQuery.data?.process) {
      setNotFoundNotice(true);
      backToList();
    }
  }, [view, activeProcessId, processQuery.isSuccess, processQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mapeia a forma de início escolhida no wizard para a etapa (aba) inicial — P0 piloto: o processo
  // começa no ponto em que a Prefeitura já está (DFD, ETP, Pesquisa ou TR), sem pré-requisito artificial.
  // Formas "importar_*" abrem a importação já expandida.
  function openForStartOption(processId: string, startOption: string) {
    const { tab, importOpen } = startTargetFor(startOption);
    setImportOpenFor(importOpen ? tab : null);
    openProcess(processId, tab);
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
        {notFoundNotice && (
          <p role="status" className="mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Processo não encontrado nesta organização. Selecione um processo da lista.
          </p>
        )}
        <ProcessoLicitatorioHome
          onCreateProcess={() => setView("new")}
          onOpenProcess={(id: string) => { setNotFoundNotice(false); openProcess(id); }}
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
            openForStartOption(processId, startOption);
          }}
        />
      </div>
    );
  }

  // ── Processo aberto (abas de etapa) ───────────────────────────────────────
  return (
    <div className="min-h-full bg-background">
      {/* Barra de contexto: breadcrumb + voltar */}
      <div className="border-b border-border bg-card px-4 py-3 sm:px-6">
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
            aria-label="Voltar aos processos"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Voltar aos processos</span>
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
            startWithImport={importOpenFor === activeTab}
            onNavigate={setActiveTab}
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
  startWithImport = false,
  onNavigate,
}: {
  tab: StageTab;
  processId: string;
  onOpenItem: (itemId: string) => void;
  startWithImport?: boolean;
  onNavigate?: (tab: StageTab) => void;
}) {
  switch (tab) {
    case "overview":
      return <ProcessOverview processId={processId} />;
    case "dfd":
      return <DFDWorkspace processId={processId} startWithImport={startWithImport} />;
    case "price":
      return <PesquisaPrecosWorkspace processId={processId} onReviewItems={() => onNavigate?.("items")} />;
    case "contract_items":
      return <ProcurementItemsWorkspace processId={processId} />;
    case "items":
      return (
        <ItemIntelligenceWorkspace
          processId={processId}
          onOpenItem={onOpenItem}
        />
      );
    case "etp":
      return <ETPWorkspace processId={processId} startWithImport={startWithImport} />;
    case "tr":
      return <TRWorkspace processId={processId} startWithImport={startWithImport} />;
    case "edital":
      return <EditalWorkspace processId={processId} onOpenTr={() => onNavigate?.("tr")} onOpenStage={(stage) => onNavigate?.(stage)} />;
    default:
      return null;
  }
}

/**
 * Drawer do item: o painel (`ProcurementItemPanel`) é o ÚNICO dono do título e do botão Fechar (um cabeçalho só);
 * aqui ficam o fundo, o diálogo acessível (nome pelo título do painel) e o Escape.
 */
export function ItemDrawer({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Foco: entra no diálogo ao abrir e volta ao gatilho ao fechar.
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Fechar painel do item"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ITEM_PANEL_TITLE_ID}
        className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-card shadow-xl focus:outline-none"
      >
        <ProcurementItemPanel itemId={itemId} onClose={onClose} />
      </div>
    </div>
  );
}

type Crumb = { label: string; onClick?: () => void };

function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1;
        // Em telas estreitas o primeiro nível ("Processo Licitatório") sai da trilha: o número do processo e a etapa
        // continuam visíveis e o botão "Voltar" cobre a navegação de retorno (evita sobreposição a 390 px).
        return (
          <span key={i} className={`flex min-w-0 items-center gap-1 ${i === 0 && trail.length > 2 ? "hidden sm:flex" : ""}`}>
            {crumb.onClick && !isLast ? (
              <button
                type="button"
                onClick={crumb.onClick}
                className="truncate whitespace-nowrap rounded font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {crumb.label}
              </button>
            ) : (
              <span
                className={`truncate whitespace-nowrap ${isLast ? "font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                {crumb.label}
              </span>
            )}
            {!isLast && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
          </span>
        );
      })}
    </nav>
  );
}
