import { useMemo, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";

const SELECT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
type Participation = { default?: string; byLot?: Record<string, string> };

/**
 * Regime de participação dos Itens (origem da autoridade): UMA configuração canônica (padrão e, opcionalmente, por lote) da qual o
 * Edital DERIVA o regime efetivo e a forma de julgamento. O Edital não pede isto de novo. Só aparece quando há modelo institucional
 * vinculado (senão a decisão não é exigida). A escrita é governada: ator humano, confirmação, idempotência e CAS.
 */
export default function ItemsParticipationCard({ processId }: { processId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.itemsParticipation.useQuery({ processId }, { enabled: !!processId, retry: false });
  const record = trpc.institutionalTemplates.governed.recordItemsParticipation.useMutation();
  const data = query.data;
  const [draft, setDraft] = useState<Participation | null>(null);
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const key = useRef<string | null>(null);
  const current: Participation = draft ?? (data?.status === "READY" ? (data.participation ?? {}) : {});
  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== JSON.stringify(data?.status === "READY" ? data.participation ?? {} : {}), [draft, data]);
  if (!data || data.status !== "READY") return null;

  const set = (patch: Participation) => setDraft({ ...current, ...patch });
  const setLot = (code: string, v: string) => {
    const byLot = { ...(current.byLot ?? {}) };
    if (v) byLot[code] = v; else delete byLot[code];
    setDraft({ ...current, byLot });
  };
  const save = async () => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid || !draft) return;
    setBusy(true); setNotice(null);
    try {
      key.current ??= crypto.randomUUID();
      const payload: Participation = { ...(draft.default ? { default: draft.default } : {}), ...(draft.byLot && Object.keys(draft.byLot).length ? { byLot: draft.byLot } : {}) };
      await record.mutateAsync({
        confirm: true, idempotencyKey: key.current, expectedRevision: data.revision, catalogVersion: data.catalogVersion, processId, participation: payload,
        decision: { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() },
      });
      key.current = null; setDraft(null); setReviewing(false); setDecision((d) => ({ ...d, confirmed: false }));
      setNotice({ kind: "ok", text: "Regime de participação registrado. O Edital passa a derivá-lo daqui." });
    } catch (e) { setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível registrar o regime.") }); }
    finally {
      await utils.procurementProcess.itemsParticipation.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      await utils.procurementProcess.editalTemplatePreflight.invalidate();
      setBusy(false);
    }
  };
  const d = data.derived;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Regime de participação dos itens" data-card="participacao">
      <h2 className="font-medium text-foreground">Regime de participação (para o Edital)</h2>
      <p className="text-sm text-muted-foreground">Defina aqui, uma vez. O Edital deriva o regime de participação e o julgamento por item ou lote desta configuração — sem pedir de novo.</p>
      <label className="flex flex-col text-sm"><span className="mb-1 font-medium">Regime padrão dos itens</span>
        <select className={SELECT} value={current.default ?? ""} disabled={busy} onChange={(e) => set({ default: e.target.value || undefined })}>
          <option value="">Não definido</option>{data.regimes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      {data.lots.length > 0 && (
        <div className="space-y-2" aria-label="Regime por lote">
          <p className="text-xs text-muted-foreground">Opcional: regime diferente por lote (substitui o padrão apenas naquele lote).</p>
          {data.lots.map((l) => (
            <label key={l.code} className="flex flex-col text-sm"><span className="mb-1">Lote {l.code} — {l.name}</span>
              <select className={SELECT} value={current.byLot?.[l.code] ?? ""} disabled={busy} onChange={(e) => setLot(l.code, e.target.value)}>
                <option value="">Usar o padrão</option>{data.regimes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          ))}
        </div>
      )}
      <ul className="space-y-1 text-xs text-muted-foreground" aria-label="O que o Edital deriva">
        <li>Julgamento por item ou lote: {d.formaJulgamento.state === "OK" ? <strong>{d.formaJulgamento.value}</strong> : d.formaJulgamento.state === "AMBIGUOUS" ? <span className="text-destructive">ambíguo — {d.formaJulgamento.reason}</span> : "sem itens"}</li>
        <li>Regime de participação: {d.regime.state === "OK" ? <strong>{d.regime.value}{d.regime.combined ? " (regimes diferentes por item/lote)" : ""}</strong> : <span className="text-amber-700 dark:text-amber-300">{d.regime.reason}</span>}</li>
      </ul>
      {notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{notice.text}</p>}
      {dirty && !reviewing && <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => setReviewing(true)}>Salvar regime de participação</button>}
      {reviewing && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Registrar regime de participação">
          <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO do regime de participação (não é preenchimento automático)." />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{busy ? "Registrando…" : "Confirmar e registrar"}</button>
            <button type="button" disabled={busy} onClick={() => setReviewing(false)} className="rounded-lg border border-input px-4 py-2 text-sm">Voltar</button>
          </div>
        </div>
      )}
    </section>
  );
}
