import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { decisionPayload, emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import DecisionFieldset from "./DecisionFieldset";
import { DEVIATION_LABEL, pendingDeviations, reviewReadiness, summarizeAcks, type AckOutcome, type ReviewStateView } from "@/lib/editalPreparation";

export interface ReviewViewProps {
  state: ReviewStateView;
  selected: ReadonlySet<string>;
  busy?: boolean;
  outcomes?: readonly AckOutcome[];
  onToggle: (blockId: string) => void;
  onAcknowledge: (blockId: string) => void;
  onAcknowledgeSelected: () => void;
  authority?: React.ReactNode;
}

/** Apresentação do estado de revisão do rascunho composto por modelo (marcadores, desvios, narrativas de IA, prontidão). */
export function EditalTemplateReviewView({ state, selected, busy = false, outcomes = [], onToggle, onAcknowledge, onAcknowledgeSelected, authority }: ReviewViewProps) {
  if (!state.composedByTemplate) return null;
  const { ready, blockers, technical } = reviewReadiness(state);
  const pending = pendingDeviations(state);
  const sum = summarizeAcks(outcomes);
  return (
    <section aria-label="Revisão do modelo institucional" className="space-y-3 rounded-xl border border-border bg-card p-5">
      <header>
        <h2 className="text-base font-semibold text-foreground">Revisão do modelo institucional</h2>
        <p className="text-xs text-muted-foreground">A emissão oficial só é aceita após o texto ser revisado por pessoa e os desvios do modelo serem reconhecidos. A revalidação final é feita pelo servidor na emissão.</p>
      </header>

      {ready
        ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Sem pendências de revisão do modelo. A emissão ainda exige revisão e confirmação humanas.</p>
        : (
          <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-amber-700 dark:text-amber-300">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
      {technical.length > 0 && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Detalhes técnicos da revalidação ({technical.length})</summary>
          <ul className="mt-1 list-disc pl-5 font-mono">{technical.map((t) => <li key={t}>{t}</li>)}</ul>
        </details>
      )}

      {(state.lateBound?.length ?? 0) > 0 && (
        <ul className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" aria-label="Campos atribuídos pelo sistema na emissão" data-late-bound="1">
          {state.lateBound!.map((l) => <li key={l.variable}>{l.message}</li>)}
        </ul>
      )}
      {state.unresolvedMarkers.count > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="font-medium">{state.unresolvedMarkers.count} marcador(es) [REVISAR] pendente(s) — substitua pelo texto revisado no editor acima.</p>
          {state.unresolvedMarkers.samples.length > 0 && <ul className="mt-1 list-disc pl-5">{state.unresolvedMarkers.samples.map((s) => <li key={s}>{s}</li>)}</ul>}
        </div>
      )}

      {state.structuralDeviations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Desvios estruturais do modelo</h3>
          <ul className="space-y-1">
            {state.structuralDeviations.map((d) => (
              <li key={d.blockId} className="flex flex-wrap items-center gap-2 text-xs">
                {!d.acknowledged && <input type="checkbox" aria-label={`Selecionar ${d.blockId}`} checked={selected.has(d.blockId)} onChange={() => onToggle(d.blockId)} />}
                <span className="font-mono">{d.blockId}</span>
                <span className="text-muted-foreground">{DEVIATION_LABEL[d.kind]}</span>
                {d.acknowledged
                  ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">Reconhecido</span>
                  : <button type="button" disabled={busy} onClick={() => onAcknowledge(d.blockId)} className="rounded-lg border border-input px-2 py-1">Reconhecer desvio</button>}
              </li>
            ))}
          </ul>
          {pending.length > 0 && authority}
          {pending.length > 0 && (
            <button type="button" disabled={busy || selected.size === 0} onClick={onAcknowledgeSelected} className="rounded-lg border border-input px-3 py-1.5 text-xs disabled:text-muted-foreground">
              Registrar reconhecimentos selecionados ({selected.size})
            </button>
          )}
          {outcomes.length > 0 && (
            <p role={sum.failed.length ? "alert" : "status"} className={`text-xs ${sum.failed.length ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>
              {sum.done} reconhecimento(s) registrado(s){sum.failed.length ? `; falha em ${sum.failed.map((f) => `${f.blockId}${f.error ? ` (${f.error})` : ""}`).join(", ")}. Os já registrados permanecem; tente novamente os restantes.` : "."}
            </p>
          )}
        </div>
      )}

      {state.aiNarratives.length > 0 && (
        <p className="text-xs text-muted-foreground">Narrativas de IA vinculadas: {state.aiNarratives.map((n) => `${n.slotKey} (${n.humanAccepted ? "aceita por pessoa" : "aguardando aceite humano"})`).join(", ")}.</p>
      )}
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Container: lê o estado de revisão e registra o reconhecimento pela rota `institutionalTemplates.reviews.acknowledgeDeviation`. */
export default function EditalTemplateReviewPanel({ processId, contentKey }: { processId: string; contentKey?: string }) {
  const utils = trpc.useUtils();
  const q = trpc.procurementProcess.editalTemplateReviewState.useQuery({ processId }, { enabled: !!processId });
  const state = q.data as ReviewStateView | undefined;
  const ack = trpc.institutionalTemplates.reviews.acknowledgeDeviation.useMutation();
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [outcomes, setOutcomes] = useState<AckOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const keys = useRef<Record<string, string>>({});
  // O texto mudou (edição/geração): o estado de revisão é recalculado pelo servidor.
  useEffect(() => { if (processId) void utils.procurementProcess.editalTemplateReviewState.invalidate({ processId }); }, [contentKey, processId]);
  if (!state) return null;

  /** Sem ato formal ⇒ `decision` omitida: o servidor registra o reconhecimento com o usuário autenticado (LICIGOV-FAST). */
  const act = () => {
    const v = validateDecisionForm(decision); setShowErrors(true);
    return v.valid ? decisionPayload(decision) : null;
  };
  /** Um write por desvio (idempotência própria por bloco); falha de um não desfaz os outros. */
  const run = async (blockIds: readonly string[]) => {
    const d = act();
    if (!d || !state.generationManifestId) return;
    setBusy(true); setOutcomes([]);
    const out: AckOutcome[] = [];
    for (const blockId of blockIds) {
      const dev = state.structuralDeviations.find((x) => x.blockId === blockId);
      if (!dev || dev.acknowledged) continue;
      try {
        await ack.mutateAsync({ manifestId: state.generationManifestId, blockId, kind: dev.kind, confirm: true, idempotencyKey: (keys.current[blockId] ??= crypto.randomUUID()), ...d });
        delete keys.current[blockId];
        out.push({ blockId, ok: true });
      } catch (e) { out.push({ blockId, ok: false, error: domainErrorMessage((e as Error).message, "falha") }); }
    }
    setOutcomes(out); setSelected(new Set()); setDecision((x) => ({ ...x, confirmed: false }));
    await Promise.all([utils.procurementProcess.editalTemplateReviewState.invalidate({ processId }), utils.procurementProcess.officialSummary.invalidate()]);
    setBusy(false);
  };
  const authority = (
    <div className="rounded-lg border border-border p-3">
      <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} legend="Registro do reconhecimento"
        consent="Confirmo que revisei o desvio e o reconheço como decisão humana." />
    </div>
  );
  return (
    <EditalTemplateReviewView state={state} selected={selected} busy={busy} outcomes={outcomes} authority={authority}
      onToggle={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      onAcknowledge={(id) => run([id])} onAcknowledgeSelected={() => run([...selected])} />
  );
}
