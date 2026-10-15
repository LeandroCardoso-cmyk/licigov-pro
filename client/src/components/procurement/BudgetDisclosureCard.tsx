import { useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { decisionPayload, emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import { formatDisplay } from "@/lib/editalPreparation";

const today = () => new Date().toISOString().slice(0, 10);
const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Dados do orçamento para documentos" — registrados UMA vez, aqui, na etapa do orçamento (Pesquisa de Preços):
 *  - DATA-BASE do orçamento estimado (decisão humana; o timestamp de criação da pesquisa é só SUGESTÃO que você confirma);
 *  - DIVULGAÇÃO do orçamento (público | sigiloso).
 * O Edital, o TR e os demais documentos apenas CONSOMEM estas decisões. Só aparece com o módulo de modelos institucionais habilitado.
 */
export default function BudgetDisclosureCard({ processId }: { processId: string }) {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.budgetDisclosure.useQuery({ processId }, { enabled: !!processId, retry: false });
  const recordDisclosure = trpc.institutionalTemplates.governed.recordBudgetDisclosure.useMutation();
  const recordBaseDate = trpc.institutionalTemplates.governed.recordBudgetBaseDate.useMutation();
  const [choice, setChoice] = useState<"publico" | "sigiloso" | "">("");
  const [baseDate, setBaseDate] = useState("");
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const keys = useRef<Record<string, string>>({});
  const s = query.data;
  if (!s || !s.enabled) return null;

  const newDisclosure = choice !== "" && choice !== s.disclosure;
  const newBaseDate = baseDate !== "" && baseDate !== s.baseDate;
  const baseDateError = baseDate !== "" && !ISO.test(baseDate) ? "Informe a data (dd/mm/aaaa)." : s.catalogVersion === null && baseDate !== "" ? "Defina os parâmetros do Edital antes de registrar a data-base." : null;
  const key = (id: string) => (keys.current[id] ??= crypto.randomUUID());
  const act = () => decisionPayload(decision);   // sem ato formal ⇒ `decision` omitida: o servidor registra com o usuário autenticado

  const save = async () => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid || (!newDisclosure && !newBaseDate) || baseDateError) return;
    setBusy(true); setNotice(null);
    try {
      if (newDisclosure) await recordDisclosure.mutateAsync({ confirm: true, idempotencyKey: key("disclosure"), expectedRevision: s.revision, processId, disclosure: choice as "publico" | "sigiloso", ...act() });
      if (newBaseDate) await recordBaseDate.mutateAsync({ confirm: true, idempotencyKey: key("basedate"), expectedRevision: s.baseDateRevision, catalogVersion: s.catalogVersion!, processId, baseDate, ...act() });
      keys.current = {}; setChoice(""); setBaseDate(""); setDecision((d) => ({ ...d, confirmed: false }));
      setNotice({ kind: "ok", text: "Dados do orçamento registrados. O Edital e os demais documentos os consomem daqui." });
    } catch (e) { setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível registrar os dados do orçamento.") }); }
    finally {
      await utils.procurementProcess.budgetDisclosure.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      await utils.procurementProcess.editalTemplatePreflight.invalidate();
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Dados do orçamento para documentos" data-card="divulgacao">
      <h2 className="font-medium text-foreground">Dados do orçamento para documentos</h2>
      <p className="text-sm text-muted-foreground">Registre uma vez. O Edital e os demais documentos apenas consomem estas decisões.</p>

      <div className="space-y-1" data-field="data-base">
        <label className="flex flex-col text-sm"><span className="mb-1 font-medium">Data-base do orçamento {!s.baseDate && <span className="text-destructive">*</span>}</span>
          <input type="date" className={INPUT} value={baseDate || s.baseDate || ""} disabled={busy} onChange={(e) => setBaseDate(e.target.value)} aria-label="Data-base do orçamento" /></label>
        {s.baseDate ? <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">Registrada: <strong>{formatDisplay("date", s.baseDate)}</strong> (revisão {s.baseDateRevision}). Para alterar, registre uma nova decisão.</p>
          : <p className="text-xs text-amber-700 dark:text-amber-300">Data-base do orçamento não registrada.</p>}
        {s.suggestedBaseDate && s.suggestedBaseDate !== s.baseDate && (
          <p className="text-xs text-muted-foreground">Sugestão: data da pesquisa — {formatDisplay("date", s.suggestedBaseDate)} (é só uma sugestão; você precisa confirmar){" "}
            <button type="button" className="text-primary underline" disabled={busy} onClick={() => setBaseDate(s.suggestedBaseDate!)}>Usar sugestão</button></p>
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

      {(newDisclosure || newBaseDate) && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Registrar dados do orçamento">
          <ul className="list-disc pl-5 text-sm">
            {newBaseDate && <li>Data-base do orçamento: {ISO.test(baseDate) ? formatDisplay("date", baseDate) : baseDate}</li>}
            {newDisclosure && <li>Divulgação do orçamento: {choice === "sigiloso" ? "sigiloso" : "público"}</li>}
          </ul>
          <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO dos dados do orçamento (não é preenchimento automático)." />
          <button type="button" disabled={busy || !!baseDateError} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{busy ? "Registrando…" : "Confirmar e registrar"}</button>
        </div>
      )}
      {notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{notice.text}</p>}
    </section>
  );
}
