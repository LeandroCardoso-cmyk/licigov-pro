import { ArrowRight, Check, ChevronRight, Download, Eye, Printer } from "lucide-react";
import {
  exportNote, JOURNEY_LABELS, nextActionLabel, nextJourneyKind, UNSAVED_EXPORT_NOTE,
  type JourneyDocPhase, type JourneyDocState, type JourneyExportAction, type JourneyKind,
} from "@/lib/documentJourney";

/**
 * LICIGOV-FAST PR-1 — barra de jornada DFD → ETP → TR → Edital (presentacional, sem rede).
 *
 * Mostra o estado REAL de cada documento (derivado de `loadProcess`), destaca a etapa aberta, navega entre as
 * etapas sem bloqueio (processo legado pode começar em qualquer uma) e oferece, para o documento aberto,
 * Visualizar / Baixar DOCX / Baixar PDF / Imprimir pelo exportador canônico. Não emite, não aprova, não gera
 * e não altera a etapa registrada do processo.
 */

const PHASE_CLASSES: Record<JourneyDocPhase, string> = {
  absent: "bg-muted text-muted-foreground",
  draft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  review: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  official: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
};

const NO_DRAFT_NOTE = "Ainda não há minuta deste documento para visualizar ou exportar.";

const ACTIONS: { action: JourneyExportAction; label: string; icon: typeof Eye; title: string }[] = [
  { action: "view", label: "Visualizar", icon: Eye, title: "Abre o PDF deste documento numa nova aba." },
  { action: "docx", label: "Baixar DOCX", icon: Download, title: "Baixa o arquivo DOCX deste documento." },
  { action: "pdf", label: "Baixar PDF", icon: Download, title: "Baixa o arquivo PDF deste documento." },
  { action: "print", label: "Imprimir", icon: Printer, title: "Abre só o PDF deste documento numa nova aba para imprimir." },
];

export type DocumentJourneyBarProps = {
  current: JourneyKind;
  states: JourneyDocState[];
  onNavigate: (kind: JourneyKind) => void;
  onExport: (action: JourneyExportAction) => void;
  /** Ação de exportação em andamento para o documento aberto (null = nenhuma). */
  pendingAction?: JourneyExportAction | null;
  /** Alguma exportação em andamento (inclusive de outra etapa): as ações ficam indisponíveis até terminar. */
  exportBusy?: boolean;
  /** Há edição não salva na etapa aberta (o arquivo usa o último conteúdo salvo). */
  hasUnsavedEdits?: boolean;
  loading?: boolean;
};

export default function DocumentJourneyBar({
  current, states, onNavigate, onExport, pendingAction = null, exportBusy = false, hasUnsavedEdits = false, loading = false,
}: DocumentJourneyBarProps) {
  const currentState = states.find((s) => s.kind === current);
  const nextKind = nextJourneyKind(current);
  const nextState = nextKind ? states.find((s) => s.kind === nextKind) : undefined;
  const canExport = !loading && !!currentState?.exportable;
  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground";

  return (
    <section aria-label="Jornada documental" data-testid="document-journey" className="border-b border-border bg-card/60 px-4 py-3 sm:px-6">
      <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="Documentos do processo">
        {states.map((s, i) => {
          const active = s.kind === current;
          return (
            <li key={s.kind} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onNavigate(s.kind)}
                aria-current={active ? "step" : undefined}
                title={`${JOURNEY_LABELS[s.kind].long} — ${s.label}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground hover:bg-accent"
                }`}
              >
                {s.phase === "official" && <Check className="h-3 w-3" aria-hidden="true" />}
                <span>{JOURNEY_LABELS[s.kind].short}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${PHASE_CLASSES[s.phase]}`}>
                  {loading ? "…" : s.label}
                </span>
              </button>
              {i < states.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Ações do ${JOURNEY_LABELS[current].short}`}>
          {ACTIONS.map(({ action, label, icon: Icon, title }) => (
            <button
              key={action}
              type="button"
              onClick={() => onExport(action)}
              disabled={!canExport || pendingAction !== null || exportBusy}
              title={canExport ? title : NO_DRAFT_NOTE}
              className={btn}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {pendingAction === action ? "Preparando…" : label}
            </button>
          ))}
        </div>
        {nextState && (
          <button
            type="button"
            onClick={() => onNavigate(nextState.kind)}
            className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            {nextActionLabel(nextState)}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {!loading && currentState && (
        <p className="mt-2 text-xs text-muted-foreground" role="note">
          {exportNote(currentState)}
          {hasUnsavedEdits && currentState.exportable && <span className="ml-1 font-medium text-amber-700 dark:text-amber-300">{UNSAVED_EXPORT_NOTE}</span>}
        </p>
      )}
    </section>
  );
}
