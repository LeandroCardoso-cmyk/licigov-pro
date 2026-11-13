import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { decisionPayload, emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import DecisionFieldset from "./DecisionFieldset";
import {
  DEVIATION_LABEL, SLOT_STATE_LABEL, dataMarkerCount, pendingDeviations, reviewReadiness, summarizeAcks,
  type AckOutcome, type ReviewStateView, type SlotView,
} from "@/lib/editalPreparation";

export type SlotResolutionKind = "HUMAN_TEXT" | "DECLARED_NONE";
export interface SlotOutcome { slotKey: string; ok: boolean; message: string }

export interface ReviewViewProps {
  state: ReviewStateView;
  selected: ReadonlySet<string>;
  busy?: boolean;
  outcomes?: readonly AckOutcome[];
  onToggle: (blockId: string) => void;
  onAcknowledge: (blockId: string) => void;
  onAcknowledgeSelected: () => void;
  authority?: React.ReactNode;
  /** E2 — texto em edição por trecho, ação de registro e último resultado. Ausentes ⇒ trechos só informativos. */
  slotText?: Readonly<Record<string, string>>;
  onSlotText?: (slotKey: string, text: string) => void;
  onResolveSlot?: (slot: SlotView, resolution: SlotResolutionKind) => void;
  slotOutcome?: SlotOutcome | null;
  /** Bloqueio do registro de trechos (ex.: alterações não salvas no editor). */
  slotDisabledReason?: string | null;
}

/** Entorno exibido sem a marcação Markdown do rascunho (títulos `#`, negrito `**`) — só apresentação. */
const plainContext = (t: string) => t.replace(/^#{1,6}\s+/gm, "").replace(/\*\*/g, "");

const fmtDate = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : null);

/** E2 — um trecho pendente do modelo: redigir ou (se elegível) declarar que não há conteúdo adicional. Sem confirmação extra: o botão é o ato. */
function SlotItem({ slot, text, busy, disabledReason, onText, onResolve }: {
  slot: SlotView; text: string; busy: boolean; disabledReason: string | null;
  onText?: (t: string) => void; onResolve?: (r: SlotResolutionKind) => void;
}) {
  const resolved = slot.state === "RESOLVED";
  const canAct = !!onResolve && !busy && !disabledReason;
  const who = slot.resolvedByName ? `${slot.resolution === "DECLARED_NONE" ? "Declarado sem conteúdo adicional" : "Redigido"} por ${slot.resolvedByName}${fmtDate(slot.resolvedAt) ? ` em ${fmtDate(slot.resolvedAt)}` : ""}` : null;
  const editor = onText && onResolve && (
    <div className="mt-2 space-y-2">
      {slot.inline
        ? <input type="text" aria-label={`Redação: ${slot.label}`} value={text} onChange={(e) => onText(e.target.value)} disabled={busy} className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs" />
        : <textarea aria-label={`Redação: ${slot.label}`} value={text} onChange={(e) => onText(e.target.value)} disabled={busy} rows={4} className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs" />}
      {slot.inline && <p className="text-[11px] text-muted-foreground">Este trecho completa uma frase do modelo: redija em um único parágrafo. A pontuação final da frase já está no modelo.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canAct || !text.trim()} onClick={() => onResolve("HUMAN_TEXT")} className="rounded-lg border border-input px-2 py-1 text-xs disabled:text-muted-foreground">Registrar redação deste trecho</button>
        {slot.declaredNoneAllowed && (
          <button type="button" disabled={!canAct} onClick={() => onResolve("DECLARED_NONE")} title={slot.declaredNoneText ?? undefined} className="rounded-lg border border-input px-2 py-1 text-xs disabled:text-muted-foreground">Não há conteúdo adicional</button>
        )}
      </div>
      {slot.declaredNoneAllowed && slot.declaredNoneText && <p className="text-[11px] text-muted-foreground">“Não há conteúdo adicional” registra no texto: {slot.declaredNoneText}</p>}
    </div>
  );
  return (
    <li className="rounded-lg border border-border px-3 py-2 text-xs" data-slot={slot.slotKey} data-slot-state={slot.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{slot.label}</span>
        <span className={`rounded px-1.5 py-0.5 ${resolved ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>{SLOT_STATE_LABEL[slot.state]}</span>
      </div>
      {slot.context && (
        <blockquote className="mt-1 whitespace-pre-line border-l-2 border-amber-500/50 pl-2 text-muted-foreground" aria-label={`Onde o trecho entra no Edital: ${slot.label}`} data-slot-context="1">
          <span className="font-medium text-foreground">No Edital: </span>
          {plainContext(slot.context.before)}
          <mark className={`rounded bg-amber-500/20 px-1 text-foreground ${slot.inline ? "" : "my-1 block w-fit"}`}>{slot.inline ? "▢ este trecho" : "▢ este trecho (parágrafo próprio)"}</mark>
          {plainContext(slot.context.after)}
        </blockquote>
      )}
      {!resolved && slot.reason && <p className="mt-1 text-muted-foreground">{slot.reason}</p>}
      {who && <p className="mt-1 text-muted-foreground">{who}.</p>}
      {resolved
        ? editor && <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Registrar nova redação</summary>{editor}</details>
        : editor}
    </li>
  );
}

/** Apresentação do estado de revisão do rascunho composto por modelo (marcadores, desvios, narrativas de IA, prontidão). */
export function EditalTemplateReviewView({
  state, selected, busy = false, outcomes = [], onToggle, onAcknowledge, onAcknowledgeSelected, authority,
  slotText = {}, onSlotText, onResolveSlot, slotOutcome = null, slotDisabledReason = null,
}: ReviewViewProps) {
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
      {(state.slots?.length ?? 0) > 0 && (
        <div className="space-y-2" aria-label="Trechos do modelo para redação supervisionada">
          <h3 className="text-sm font-semibold">Trechos do modelo para redação</h3>
          <p className="text-xs text-muted-foreground">Cada trecho precisa ser redigido por pessoa (ou, quando o modelo permite, declarado sem conteúdo adicional). Apagar o marcador [REVISAR] não resolve o trecho.</p>
          {slotDisabledReason && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{slotDisabledReason}</p>}
          <ul className="space-y-2">
            {state.slots!.map((sl) => (
              <SlotItem key={sl.slotKey} slot={sl} text={slotText[sl.slotKey] ?? sl.currentText ?? ""} busy={busy} disabledReason={slotDisabledReason}
                onText={onSlotText ? (t) => onSlotText(sl.slotKey, t) : undefined} onResolve={onResolveSlot ? (r) => onResolveSlot(sl, r) : undefined} />
            ))}
          </ul>
          {slotOutcome && <p role={slotOutcome.ok ? "status" : "alert"} className={`text-xs ${slotOutcome.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{slotOutcome.message}</p>}
        </div>
      )}

      {dataMarkerCount(state) > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="font-medium">{dataMarkerCount(state)} marcador(es) [REVISAR] pendente(s) — substitua pelo texto revisado no editor acima.</p>
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
export default function EditalTemplateReviewPanel({ processId, contentKey, editorDirty = false }: { processId: string; contentKey?: string; editorDirty?: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.procurementProcess.editalTemplateReviewState.useQuery({ processId }, { enabled: !!processId });
  const state = q.data as ReviewStateView | undefined;
  const ack = trpc.institutionalTemplates.reviews.acknowledgeDeviation.useMutation();
  const resolve = trpc.institutionalTemplates.reviews.resolveSlot.useMutation();
  const [slotText, setSlotText] = useState<Record<string, string>>({});
  const [slotOutcome, setSlotOutcome] = useState<SlotOutcome | null>(null);
  const slotKeys = useRef<Record<string, string>>({});
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
  /**
   * E2 — um ato por clique: o servidor localiza o trecho, grava a edição governada e a resolução (mesma transação) com o usuário autenticado.
   * CAS: hash do rascunho exibido + revisão atual da resolução; a chave de idempotência é mantida até o sucesso (retry seguro).
   */
  const resolveSlot = async (slot: SlotView, resolution: SlotResolutionKind) => {
    if (!state.generationManifestId || !contentKey) return;
    const text = resolution === "HUMAN_TEXT" ? (slotText[slot.slotKey] ?? slot.currentText ?? "") : undefined;
    const keyId = `${slot.slotKey}:${resolution}:${slot.revision}:${contentKey}:${text ?? ""}`;
    setBusy(true); setSlotOutcome(null);
    try {
      await resolve.mutateAsync({
        processId, manifestId: state.generationManifestId, slotKey: slot.slotKey, resolution, ...(text !== undefined ? { text } : {}),
        expectedContentHash: contentKey, expectedRevision: slot.revision, confirm: true, idempotencyKey: (slotKeys.current[keyId] ??= crypto.randomUUID()),
      });
      delete slotKeys.current[keyId];
      setSlotText((m) => { const n = { ...m }; delete n[slot.slotKey]; return n; });
      setSlotOutcome({ slotKey: slot.slotKey, ok: true, message: `Trecho "${slot.label}" registrado.` });
    } catch (e) {
      setSlotOutcome({ slotKey: slot.slotKey, ok: false, message: `Trecho "${slot.label}": ${domainErrorMessage((e as Error).message, "não foi possível registrar")}` });
    }
    await Promise.all([
      utils.procurementProcess.reviewableDraft.invalidate({ processId, kind: "edital" }),
      utils.procurementProcess.editalTemplateReviewState.invalidate({ processId }),
      utils.procurementProcess.officialSummary.invalidate(),
    ]);
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
      slotText={slotText} onSlotText={(k, t) => setSlotText((m) => ({ ...m, [k]: t }))} onResolveSlot={(sl, r) => void resolveSlot(sl, r)}
      slotOutcome={slotOutcome} slotDisabledReason={editorDirty ? "Salve ou descarte as alterações do editor antes de registrar um trecho." : null}
      onToggle={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
      onAcknowledge={(id) => run([id])} onAcknowledgeSelected={() => run([...selected])} />
  );
}
