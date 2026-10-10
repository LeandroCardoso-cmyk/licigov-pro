import { useMemo, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import EditalPreparationView from "./EditalPreparationView";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import {
  STALE_NOTICE, buildSavePlan, executeSavePlan, isStaleSave, liveOptionalItems, livePendingItems,
  type FormValue, type PlannedWrite, type StageTarget, type PrepField, type PreparationStateView, type SaveOutcome, type SectionEdits,
} from "@/lib/editalPreparation";

export interface EditalPreparationParams { modality?: string; form?: string; platform?: string }
export interface EditalPreparationPanelProps {
  processId: string;
  params: EditalPreparationParams;
  /** TR oficial EXATO escolhido (id + versão + hash): as projeções do TR só existem para um pin válido. */
  trPin?: { documentId: string; version: number; contentHash: string } | null;
  /** Chamado após QUALQUER registro bem-sucedido (a workspace revalida o preflight). */
  onChanged?: () => void;
  /** Abre o TR do processo (Parâmetros estruturados). */
  onOpenTr?: () => void;
  /** Abre a etapa onde um dado é resolvido na origem (Itens, Pesquisa de Preços, DFD, TR). */
  onOpenStage?: (stage: StageTarget) => void;
}

type State = PreparationStateView | { status: "UNAVAILABLE"; resolution: string; reason: string };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Container da "Preparação do Edital institucional": estado do servidor + edições locais + UMA confirmação humana que registra
 * todas as decisões digitadas. As escritas são SEQUENCIAIS, pelos endpoints governados existentes, cada uma com idempotência
 * própria e CAS encadeado; conflito ⇒ para, recarrega e informa o que já foi registrado (nunca sobrescreve).
 */
export default function EditalPreparationPanel({ processId, params, trPin = null, onChanged, onOpenTr, onOpenStage }: EditalPreparationPanelProps) {
  const utils = trpc.useUtils();
  const input = { processId, ...params, ...(trPin ? { officialPins: { TR: trPin } } : {}) } as never;
  const query = trpc.procurementProcess.editalTemplatePreparation.useQuery(input, { enabled: !!processId });
  const data = query.data as State | undefined;
  const state = data?.status === "READY_FOR_PREPARATION" ? data : undefined;

  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [edits, setEdits] = useState<Record<string, SectionEdits>>({});
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "stale"; text: string } | null>(null);
  // Uma chave por TENTATIVA lógica de cada escrita (retry reutiliza; sucesso/obsolescência descartam).
  const keys = useRef<Record<string, string>>({});

  // CertameConfig: a escrita SEMÂNTICA das decisões do certame (não "campo do Edital").
  const recordProcess = trpc.institutionalTemplates.governed.recordCertameConfig.useMutation();
  const recordOrg = trpc.institutionalTemplates.governed.recordOrganizationFields.useMutation();

  const plan = useMemo(() => (state ? buildSavePlan(state, { edits }) : { writes: [], errors: {}, decisionCount: 0 }), [state, edits]);
  const pending = useMemo(() => (state ? livePendingItems(state, edits) : []), [state, edits]);
  const optional = useMemo(() => (state ? liveOptionalItems(state, edits) : []), [state, edits]);
  if (!state) return null;

  const onEdit = (source: string, f: PrepField, v: FormValue) => setEdits((p) => ({ ...p, [source]: { ...(p[source] ?? {}), [f.path]: v } }));

  const confirm = async () => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid || plan.writes.length === 0) return;
    const act = { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() };
    const key = (w: PlannedWrite) => (keys.current[w.id] ??= crypto.randomUUID());
    setBusy(true); setNotice(null); setOutcome(null);
    const writer = {
      async write(w: PlannedWrite, expectedRevision: number) {
        const base = { confirm: true as const, idempotencyKey: key(w), decision: act, expectedRevision };
        if (w.kind === "ORG") {
          const r = await recordOrg.mutateAsync({ ...base, catalogVersion: state.catalogVersion, source: w.source as "POLICY" | "IDENTITY", fields: w.fields ?? {} });
          return { revision: r.decision.revision };
        }
        const r = await recordProcess.mutateAsync({
          ...base, catalogVersion: state.catalogVersion, processId, source: w.source as never, fields: w.fields ?? {},
        });
        return { revision: r.decision.revision };
      },
    };
    const result = await executeSavePlan(plan.writes, state.revisions, writer, (e) => isStaleSave((e as { data?: { code?: string } }).data?.code, e instanceof Error ? e.message : String(e)));
    for (const w of result.registered) delete keys.current[w.id];
    setEdits((p) => {
      const n = { ...p };
      for (const w of result.registered) if (w.source) delete n[w.source];
      return n;
    });
    setOutcome(result);
    setDecision((d) => ({ ...d, confirmed: false }));   // cada ato exige nova confirmação explícita
    if (!result.failed) { setReviewing(false); setNotice({ kind: "ok", text: "Decisões registradas. O preflight foi atualizado." }); }
    else if (result.failed.stale) { keys.current = {}; setNotice({ kind: "stale", text: STALE_NOTICE }); }
    else setNotice({ kind: "error", text: domainErrorMessage(result.failed.message, "Não foi possível registrar.") });
    await utils.procurementProcess.editalTemplatePreparation.invalidate();
    if (result.registered.length > 0) onChanged?.();
    setBusy(false);
  };

  return (
    <EditalPreparationView
      state={state} edits={edits} fieldErrors={plan.errors} pending={pending} optional={optional} onEdit={onEdit}
      plan={plan} reviewing={reviewing} onStartReview={() => { setOutcome(null); setNotice(null); setReviewing(true); }} onCancelReview={() => setReviewing(false)}
      decision={decision} onDecision={setDecision} showErrors={showErrors} busy={busy} outcome={outcome} notice={notice} onConfirm={confirm}
      onOpenTr={onOpenTr} onOpenStage={onOpenStage} onRefresh={() => { void utils.procurementProcess.editalTemplatePreparation.invalidate(); }} processId={processId}
    />
  );
}
