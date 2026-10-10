import { useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import { formatDisplay } from "@/lib/editalPreparation";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Divulgação do orçamento (público | sigiloso) — registrada UMA vez, aqui, na etapa do orçamento. O Edital apenas consome:
 * ele não tem mais este campo. A data-base do orçamento é derivada da pesquisa de preços que originou os itens aprovados.
 * Só aparece quando o módulo de modelos institucionais está habilitado para a organização.
 */
export default function BudgetDisclosureCard({ processId }: { processId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.budgetDisclosure.useQuery({ processId }, { enabled: !!processId, retry: false });
  const record = trpc.institutionalTemplates.governed.recordBudgetDisclosure.useMutation();
  const [choice, setChoice] = useState<"publico" | "sigiloso" | "">("");
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const key = useRef<string | null>(null);
  const s = query.data;
  if (!s || !s.enabled) return null;

  const save = async () => {
    setShowErrors(true);
    if (!choice || !validateDecisionForm(decision).valid) return;
    setBusy(true); setNotice(null);
    try {
      key.current ??= crypto.randomUUID();
      await record.mutateAsync({
        confirm: true, idempotencyKey: key.current, expectedRevision: s.revision, processId, disclosure: choice,
        decision: { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() },
      });
      key.current = null; setChoice(""); setDecision((d) => ({ ...d, confirmed: false }));
      setNotice({ kind: "ok", text: "Divulgação do orçamento registrada. O Edital a consome daqui." });
    } catch (e) { setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível registrar a divulgação.") }); }
    finally {
      await utils.procurementProcess.budgetDisclosure.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      await utils.procurementProcess.editalTemplatePreflight.invalidate();
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Divulgação do orçamento" data-card="divulgacao">
      <h2 className="font-medium text-foreground">Divulgação do orçamento</h2>
      <p className="text-sm text-muted-foreground">Registre uma vez se o orçamento estimado será público ou sigiloso. O Edital apenas consome esta decisão.</p>
      <p className="text-sm">Data-base do orçamento: {s.baseDate ? <strong>{formatDisplay("date", s.baseDate)}</strong> : <span className="text-amber-700 dark:text-amber-300">disponível quando houver itens aprovados originados de uma pesquisa de preços</span>}</p>
      {s.disclosure && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">Registrada: <strong>{s.disclosure === "sigiloso" ? "Sigiloso" : "Público"}</strong> (revisão {s.revision}). Para alterar, registre uma nova decisão.</p>}
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="text-sm font-medium">{s.disclosure ? "Alterar divulgação" : "Divulgação"} {!s.disclosure && <span className="text-destructive">*</span>}</legend>
        <div className="flex gap-4 text-sm">
          {(["publico", "sigiloso"] as const).map((o) => (
            <label key={o} className="flex items-center gap-1"><input type="radio" name="budget-disclosure" checked={choice === o} onChange={() => setChoice(o)} />{o === "publico" ? "Público" : "Sigiloso"}</label>
          ))}
        </div>
      </fieldset>
      {choice && choice !== s.disclosure && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Registrar divulgação do orçamento">
          <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO da divulgação do orçamento (não é preenchimento automático)." />
          <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{busy ? "Registrando…" : "Confirmar e registrar"}</button>
        </div>
      )}
      {notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{notice.text}</p>}
    </section>
  );
}
