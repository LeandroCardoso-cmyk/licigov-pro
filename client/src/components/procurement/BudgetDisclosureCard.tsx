import { useRef, useState } from "react";
import { baseDateSuggestion, BASE_DATE_SUGGESTION_LABEL } from "@/lib/budgetBaseDateSuggestion";
import { trpc } from "../../lib/trpc";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { decisionPayload, emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import { formatDisplay } from "@/lib/editalPreparation";
import {
  BUDGET_FIELD_LABEL, BUDGET_STATUS_HINT, BUDGET_STATUS_LABEL, budgetAllocationPlan, type BudgetAllocationEdits, type BudgetFieldStatus,
} from "@/lib/budgetAllocation";

const today = () => new Date().toISOString().slice(0, 10);
const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Dados do orçamento para documentos" — registrados UMA vez, aqui, na etapa do orçamento (Pesquisa de Preços):
 *  - DATA-BASE do orçamento estimado (decisão humana; o timestamp de criação da pesquisa é só SUGESTÃO que você confirma);
 *  - DIVULGAÇÃO do orçamento (público | sigiloso).
 * O Edital, o TR e os demais documentos apenas CONSOMEM estas decisões. Só aparece com o módulo de modelos institucionais habilitado.
 *
 * LICIGOV-FAST PR-2 — também a DOTAÇÃO ORÇAMENTÁRIA e a FONTE DE RECURSOS do processo (declaradas uma vez; o TR e o Edital reaproveitam).
 * `mode="allocation"` mostra só esses dois campos (embutido no TR/Edital: a Pesquisa de Preços não é etapa obrigatória para informá-los).
 * Ausentes não bloqueiam nada; um valor registrado só é substituído com confirmação explícita.
 */
const STATUS_TONE: Readonly<Record<BudgetFieldStatus, string>> = {
  DECLARED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PENDING: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  NOT_APPLICABLE: "bg-muted text-muted-foreground",
};

export default function BudgetDisclosureCard({ processId, mode = "full" }: { processId: string; mode?: "full" | "allocation" }) {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.budgetDisclosure.useQuery({ processId }, { enabled: !!processId, retry: false });
  const recordDisclosure = trpc.institutionalTemplates.governed.recordBudgetDisclosure.useMutation();
  const recordBaseDate = trpc.institutionalTemplates.governed.recordBudgetBaseDate.useMutation();
  const recordAllocation = trpc.institutionalTemplates.governed.recordBudgetAllocation.useMutation();
  const [allocationEdits, setAllocationEdits] = useState<BudgetAllocationEdits>({});
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [choice, setChoice] = useState<"publico" | "sigiloso" | "">("");
  const [baseDate, setBaseDate] = useState("");
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const keys = useRef<Record<string, string>>({});
  const s = query.data;
  if (!s || !s.enabled) return null;
  const allocation = s.allocation;
  if (mode === "allocation" && !allocation) return null;
  const plan = allocation ? budgetAllocationPlan(allocation, allocationEdits) : { payload: {}, replaces: [], changed: false };
  const replaceError = plan.replaces.length > 0 && !confirmReplace ? "Confirme a substituição do valor já registrado." : null;

  const newDisclosure = mode === "full" && choice !== "" && choice !== s.disclosure;
  const newBaseDate = mode === "full" && baseDate !== "" && baseDate !== s.baseDate;
  const baseDateError = baseDate !== "" && !ISO.test(baseDate) ? "Informe a data (dd/mm/aaaa)." : s.catalogVersion === null && baseDate !== "" ? "Defina os parâmetros do Edital antes de registrar a data-base." : null;
  const key = (id: string) => (keys.current[id] ??= crypto.randomUUID());
  const act = () => decisionPayload(decision);   // sem ato formal ⇒ `decision` omitida: o servidor registra com o usuário autenticado

  const save = async () => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid || (!newDisclosure && !newBaseDate && !plan.changed) || baseDateError || replaceError) return;
    setBusy(true); setNotice(null);
    try {
      // Cada gravação bem-sucedida libera a SUA chave: uma falha posterior não prende a pessoa numa chave já usada com outro conteúdo.
      if (newDisclosure) { await recordDisclosure.mutateAsync({ confirm: true, idempotencyKey: key("disclosure"), expectedRevision: s.revision, processId, disclosure: choice as "publico" | "sigiloso", ...act() }); delete keys.current.disclosure; }
      // Mesmo registro governado (CAS): a data-base e a dotação/fonte são gravadas em sequência, com a revisão atualizada.
      let processRevision = s.baseDateRevision;
      if (newBaseDate) {
        const r = await recordBaseDate.mutateAsync({ confirm: true, idempotencyKey: key("basedate"), expectedRevision: processRevision, catalogVersion: s.catalogVersion!, processId, baseDate, ...act() });
        processRevision = r.decision.revision;
        delete keys.current.basedate;
      }
      if (plan.changed && allocation) {
        await recordAllocation.mutateAsync({
          confirm: true, idempotencyKey: key("allocation"), expectedRevision: processRevision, catalogVersion: allocation.catalogVersion, processId,
          ...plan.payload, ...(plan.replaces.length > 0 ? { confirmReplace: true } : {}), ...act(),
        });
        delete keys.current.allocation;
      }
      keys.current = {}; setChoice(""); setBaseDate(""); setAllocationEdits({}); setConfirmReplace(false); setDecision((d) => ({ ...d, confirmed: false }));
      setNotice({ kind: "ok", text: "Dados do orçamento registrados. O TR, o Edital e os demais documentos os reaproveitam daqui." });
    } catch (e) { setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível registrar os dados do orçamento.") }); }
    finally {
      await utils.procurementProcess.budgetDisclosure.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      await utils.procurementProcess.editalTemplatePreflight.invalidate();
      await utils.procurementProcess.trStructuredParams.invalidate();
      await utils.procurementProcess.authoringSourceState.invalidate();
      await utils.procurementProcess.reviewableDraft.invalidate();
      setBusy(false);
    }
  };
  const allocationSection = allocation && (
    <div className="space-y-2" data-field="dotacao-fonte">
      {(["dotacao", "fonte"] as const).map((k) => {
        const f = allocation[k];
        return (
          <div key={k} className="space-y-1">
            <label className="flex flex-col text-sm">
              <span className="mb-1 flex items-center gap-2 font-medium">
                {BUDGET_FIELD_LABEL[k]}
                <span className={`rounded px-1.5 py-0.5 text-xs font-normal ${STATUS_TONE[f.status]}`} title={BUDGET_STATUS_HINT[f.status]} data-status={f.status}>{BUDGET_STATUS_LABEL[f.status]}</span>
              </span>
              <input type="text" className={INPUT} maxLength={500} disabled={busy} value={allocationEdits[k] ?? f.value ?? ""}
                placeholder={f.status === "NOT_APPLICABLE" ? "Registro de preços: informe se já conhecida (opcional)" : "Ex.: 02.001.04.122.0002.2.003 — 3.3.90.30"}
                onChange={(e) => { setAllocationEdits((x) => ({ ...x, [k]: e.target.value })); setConfirmReplace(false); }} aria-label={BUDGET_FIELD_LABEL[k]} />
            </label>
            <p className="text-xs text-muted-foreground">{BUDGET_STATUS_HINT[f.status]}</p>
          </div>
        );
      })}
    </div>
  );
  const pendingChanges = newDisclosure || newBaseDate || plan.changed;
  const confirmPanel = pendingChanges && (
    <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Registrar dados do orçamento">
      <ul className="list-disc pl-5 text-sm">
        {newBaseDate && <li>Data-base do orçamento: {ISO.test(baseDate) ? formatDisplay("date", baseDate) : baseDate}</li>}
        {newDisclosure && <li>Divulgação do orçamento: {choice === "sigiloso" ? "sigiloso" : "público"}</li>}
        {plan.payload.dotacaoOrcamentaria && <li>Dotação orçamentária: {plan.payload.dotacaoOrcamentaria}</li>}
        {plan.payload.fonteRecursos && <li>Fonte de recursos: {plan.payload.fonteRecursos}</li>}
      </ul>
      {plan.replaces.length > 0 && allocation && (
        <label className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300" data-testid="budget-replace-confirm">
          <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} className="mt-1" />
          <span>Substituir o valor já registrado ({plan.replaces.map((k) => `${BUDGET_FIELD_LABEL[k]}: “${allocation[k].value}”`).join("; ")}). O histórico é preservado.</span>
        </label>
      )}
      <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO dos dados do orçamento (não é preenchimento automático)." />
      {replaceError && showErrors && <p role="alert" className="text-xs text-destructive">{replaceError}</p>}
      <button type="button" disabled={busy || !!baseDateError} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{busy ? "Registrando…" : "Registrar dados do orçamento"}</button>
    </div>
  );
  const noticeLine = notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{notice.text}</p>;

  if (mode === "allocation") {
    return (
      <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Dados orçamentários do processo" data-card="dotacao-fonte">
        <h3 className="text-sm font-medium text-foreground">Dados orçamentários do processo</h3>
        <p className="text-xs text-muted-foreground">Informe uma vez: o TR e o Edital usam o mesmo registro. Se ainda não souber, siga em frente — o documento indica a pendência.</p>
        {allocationSection}
        {confirmPanel}
        {noticeLine}
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Dados do orçamento para documentos" data-card="divulgacao">
      <h2 className="font-medium text-foreground">Dados do orçamento para documentos</h2>
      <p className="text-sm text-muted-foreground">Registre uma vez. O TR, o Edital e os demais documentos apenas consomem estas informações.</p>

      <div className="space-y-1" data-field="data-base">
        <label className="flex flex-col text-sm"><span className="mb-1 font-medium">Data-base do orçamento {!s.baseDate && <span className="text-destructive">*</span>}</span>
          <input type="date" className={INPUT} value={baseDate || s.baseDate || ""} disabled={busy} onChange={(e) => setBaseDate(e.target.value)} aria-label="Data-base do orçamento" /></label>
        {s.baseDate ? <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">Registrada: <strong>{formatDisplay("date", s.baseDate)}</strong> (revisão {s.baseDateRevision}). Para alterar, registre uma nova decisão.</p>
          : <p className="text-xs text-amber-700 dark:text-amber-300">Data-base do orçamento não registrada.</p>}
        {/* M8: a sugestão é a data em que a pesquisa foi REGISTRADA no sistema (não a data declarada no documento da pesquisa)
            e só aparece enquanto não há data-base registrada. */}
        {baseDateSuggestion(s) && (
          <p className="text-xs text-muted-foreground">{BASE_DATE_SUGGESTION_LABEL} — {formatDisplay("date", baseDateSuggestion(s)!)} (não é necessariamente a data da pesquisa declarada no documento; confirme a data-base){" "}
            <button type="button" className="text-primary underline" disabled={busy} onClick={() => setBaseDate(baseDateSuggestion(s)!)}>Usar sugestão</button></p>
        )}
        {baseDateError && <p role="alert" className="text-xs text-destructive">{baseDateError}</p>}
      </div>

      {s.disclosure && <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">Divulgação registrada: <strong>{s.disclosure === "sigiloso" ? "Sigiloso" : "Público"}</strong> (revisão {s.revision}).</p>}
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="text-sm font-medium">{s.disclosure ? "Alterar divulgação" : "Divulgação"} {!s.disclosure && <span className="text-destructive">*</span>}</legend>
        <div className="flex gap-4 text-sm">
          {(["publico", "sigiloso"] as const).map((o) => (
            <label key={o} className="flex items-center gap-1"><input type="radio" name="budget-disclosure" checked={choice === o} onChange={() => setChoice(o)} />{o === "publico" ? "Público" : "Sigiloso"}</label>
          ))}
        </div>
      </fieldset>

      {allocationSection}
      {confirmPanel}
      {noticeLine}
    </section>
  );
}
