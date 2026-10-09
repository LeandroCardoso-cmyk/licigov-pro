import { useMemo, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import PrepFieldControl from "./PrepFieldControl";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import {
  SOURCE_TITLE, STALE_NOTICE, STATUS_LABEL, buildSectionFields, groupSections, groupStatus, isStaleSave, sectionStatus, toFormValue, totalPending,
  type FormValue, type PrepField, type PrepSection, type SectionEdits, type SectionStatus,
} from "@/lib/editalPreparation";

export interface EditalPreparationParams { modality?: string; form?: string; platform?: string }
export interface EditalPreparationPanelProps {
  processId: string;
  params: EditalPreparationParams;
  /** Chamado após QUALQUER registro bem-sucedido (a workspace revalida o preflight). */
  onChanged?: () => void;
}

type PreparationState = {
  status: "READY_FOR_PREPARATION"; revisionId: string; catalogVersion: string;
  revisions: { process: number; organization: number; budget: number };
  budgetDisclosure: "publico" | "sigiloso" | null;
  participation: { default?: string; byLot?: Record<string, string>; byItem?: Record<string, string> } | null;
  sections: PrepSection[];
  authorityOwned: { name: string; source: string; path: string }[];
} | { status: "UNAVAILABLE"; resolution: string; reason: string };

const today = () => new Date().toISOString().slice(0, 10);
const BADGE: Record<SectionStatus, string> = {
  COMPLETO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  PENDENTE: "bg-destructive/15 text-destructive",
  CONDICIONAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};
export function StatusBadge({ status }: { status: SectionStatus }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * "Preparação do Edital institucional": a pessoa registra, por tipo de dado, os campos GOVERNADOS que o modelo vinculado consome.
 * Os campos vêm do servidor (catálogo da revisão exata); a escrita usa os endpoints governados existentes, como ATO HUMANO declarado
 * (autoridade, referência do ato, justificativa, confirmação explícita), com CAS do registro inteiro e idempotência por tentativa.
 * Campos de autoridade canônica (nº do processo, itens, valor estimado…) aparecem à parte, somente leitura.
 */
export default function EditalPreparationPanel({ processId, params, onChanged }: EditalPreparationPanelProps) {
  const utils = trpc.useUtils();
  const input = { processId, ...params } as never;
  const query = trpc.procurementProcess.editalTemplatePreparation.useQuery(input, { enabled: !!processId });
  const state = query.data as PreparationState | undefined;

  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [edits, setEdits] = useState<Record<string, SectionEdits>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [participationDefault, setParticipationDefault] = useState<string | null>(null);
  const [disclosure, setDisclosure] = useState<"publico" | "sigiloso" | "">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "stale"; text: string } | null>(null);
  // Uma chave por TENTATIVA lógica (retry reutiliza; sucesso/obsolescência descartam).
  const keys = useRef<Record<string, string>>({});
  const keyFor = (scope: string) => (keys.current[scope] ??= crypto.randomUUID());

  const recordProcess = trpc.institutionalTemplates.governed.recordProcessFields.useMutation();
  const recordOrg = trpc.institutionalTemplates.governed.recordOrganizationFields.useMutation();
  const recordDisclosure = trpc.institutionalTemplates.governed.recordBudgetDisclosure.useMutation();

  const groups = useMemo(() => (state?.status === "READY_FOR_PREPARATION" ? groupSections(state.sections) : []), [state]);
  if (!state || state.status !== "READY_FOR_PREPARATION") return null;

  const authority = () => {
    const v = validateDecisionForm(decision);
    setShowErrors(true);
    return v.valid
      ? { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() }
      : null;
  };

  const finish = async (scope: string, ok: boolean, e?: { message: string; data?: { code?: string } | null }) => {
    if (ok) {
      delete keys.current[scope];
      setMessage({ kind: "ok", text: "Registro realizado. O preflight foi atualizado." });
      setDecision((d) => ({ ...d, confirmed: false }));   // cada ato exige nova confirmação explícita
    } else if (e && isStaleSave(e.data?.code, e.message)) {
      delete keys.current[scope];
      setMessage({ kind: "stale", text: STALE_NOTICE });
      setDecision((d) => ({ ...d, confirmed: false }));
    } else if (e) {
      setMessage({ kind: "error", text: domainErrorMessage(e.message, "Não foi possível registrar.") });
    }
    await utils.procurementProcess.editalTemplatePreparation.invalidate();
    if (ok) onChanged?.();
    setBusy(null);
  };

  const saveSection = async (section: PrepSection) => {
    const act = authority();
    const built = buildSectionFields(section, edits[section.source] ?? {});
    setFieldErrors((p) => ({ ...p, [section.source]: built.errors }));
    if (!act || Object.keys(built.errors).length > 0) return;
    setBusy(section.source); setMessage(null);
    const base = { catalogVersion: state.catalogVersion, source: section.source, fields: built.fields, confirm: true as const, idempotencyKey: keyFor(section.source), decision: act };
    try {
      if (section.scope === "ORG") {
        await recordOrg.mutateAsync({ ...base, source: section.source as "POLICY" | "IDENTITY", expectedRevision: state.revisions.organization });
      } else {
        const partDefault = participationDefault ?? state.participation?.default ?? "";
        await recordProcess.mutateAsync({
          ...base, source: section.source as never, processId, expectedRevision: state.revisions.process,
          ...(section.source === "ITEMS" && partDefault.trim() ? { participation: { ...(state.participation ?? {}), default: partDefault.trim() } } : {}),
        });
      }
      setEdits((p) => { const n = { ...p }; delete n[section.source]; return n; });
      await finish(section.source, true);
    } catch (e) { await finish(section.source, false, e as never); }
  };

  const saveDisclosure = async () => {
    const act = authority();
    if (!act || !disclosure) return;
    setBusy("DISCLOSURE"); setMessage(null);
    try {
      await recordDisclosure.mutateAsync({ processId, disclosure, confirm: true, idempotencyKey: keyFor("DISCLOSURE"), decision: act, expectedRevision: state.revisions.budget });
      await finish("DISCLOSURE", true);
    } catch (e) { await finish("DISCLOSURE", false, e as never); }
  };

  const setEdit = (source: string, f: PrepField, v: FormValue) => setEdits((p) => ({ ...p, [source]: { ...(p[source] ?? {}), [f.path]: v } }));
  const pending = totalPending(state.sections) + (state.budgetDisclosure ? 0 : 1);
  const dErr = validateDecisionForm(decision).errors;

  return (
    <section aria-label="Preparação do Edital institucional" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <header>
        <h2 className="text-base font-semibold text-foreground">Preparação do Edital institucional</h2>
        <p className="text-xs text-muted-foreground">
          Informe os dados que o modelo vinculado precisa. Cada registro é um ato humano declarado e auditável; nada é preenchido ou aprovado pelo sistema.
          {" "}{pending > 0 ? `${pending} pendência(s) obrigatória(s).` : "Sem pendências obrigatórias."}
        </p>
      </header>

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-medium text-foreground">Autoridade e confirmação do registro</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ["decidedByName", "Autoridade que decidiu (nome)", "text"], ["decidedByRole", "Cargo / função", "text"],
            ["decidedAt", "Data do ato", "date"], ["basisReference", "Referência do ato (portaria, ata, processo)", "text"],
          ] as const).map(([k, label, type]) => (
            <label key={k} className="flex flex-col text-xs">
              <span className="mb-1 font-medium">{label}</span>
              <input type={type} value={decision[k]} className="rounded-lg border border-input px-3 py-2 text-sm" onChange={(e) => setDecision({ ...decision, [k]: e.target.value })} />
              {showErrors && dErr[k] && <span role="alert" className="text-destructive">{dErr[k]}</span>}
            </label>
          ))}
        </div>
        <label className="flex flex-col text-xs">
          <span className="mb-1 font-medium">Justificativa (mín. 10 caracteres)</span>
          <textarea rows={2} value={decision.reason} className="rounded-lg border border-input px-3 py-2 text-sm" onChange={(e) => setDecision({ ...decision, reason: e.target.value })} />
          {showErrors && dErr.reason && <span role="alert" className="text-destructive">{dErr.reason}</span>}
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={decision.confirmed} onChange={(e) => setDecision({ ...decision, confirmed: e.target.checked })} />
          <span>Confirmo, como pessoa responsável, o REGISTRO destes dados como decisão humana (não é preenchimento automático).</span>
        </label>
        {showErrors && dErr.confirmed && <p role="alert" className="text-xs text-destructive">{dErr.confirmed}</p>}
      </fieldset>

      {message && (
        <p role={message.kind === "ok" ? "status" : "alert"} className={`text-sm ${message.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : message.kind === "stale" ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>
          {message.text}
        </p>
      )}

      {groups.map(({ group, sections }) => {
        const status = groupStatus(sections, group.id === "orcamento" ? state.budgetDisclosure !== null : true);
        return (
          <details key={group.id} open={status === "PENDENTE"} className="rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
              <span>{group.title}</span><StatusBadge status={status} />
            </summary>
            <div className="space-y-5 px-3 pb-3">
              {group.id === "orcamento" && (
                <fieldset className="space-y-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-medium">Divulgação do orçamento</legend>
                  <p className="text-xs text-muted-foreground">Define se o valor estimado é público ou sigiloso no Edital. Atual: {state.budgetDisclosure ?? "não registrado"}.</p>
                  <div className="flex gap-4 text-sm">
                    {(["publico", "sigiloso"] as const).map((o) => (
                      <label key={o} className="flex items-center gap-1"><input type="radio" name="edital-disclosure" checked={(disclosure || state.budgetDisclosure) === o} onChange={() => setDisclosure(o)} />{o === "publico" ? "Público" : "Sigiloso"}</label>
                    ))}
                  </div>
                  <button type="button" disabled={busy !== null || !disclosure} onClick={saveDisclosure} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
                    {busy === "DISCLOSURE" ? "Registrando…" : "Registrar divulgação"}
                  </button>
                </fieldset>
              )}
              {sections.map((section) => (
                <div key={section.source} className="space-y-3" data-source={section.source}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{SOURCE_TITLE[section.source] ?? section.source}</h3>
                    <StatusBadge status={sectionStatus(section)} />
                  </div>
                  {section.source === "ITEMS" && (
                    <label className="flex flex-col text-sm">
                      <span className="mb-1 font-medium">Regime de participação padrão dos itens</span>
                      <input type="text" className="rounded-lg border border-input px-3 py-2 text-sm" value={participationDefault ?? state.participation?.default ?? ""} onChange={(e) => setParticipationDefault(e.target.value)} />
                    </label>
                  )}
                  {section.fields.map((f) => (
                    <PrepFieldControl key={f.path} field={f} value={edits[section.source]?.[f.path] ?? toFormValue(f, f.currentValue)} error={fieldErrors[section.source]?.[f.path]}
                      disabled={busy !== null} onChange={(v) => setEdit(section.source, f, v)} />
                  ))}
                  <button type="button" disabled={busy !== null} onClick={() => saveSection(section)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
                    {busy === section.source ? "Registrando…" : `Registrar ${SOURCE_TITLE[section.source]?.toLowerCase() ?? section.source}`}
                  </button>
                </div>
              ))}
            </div>
          </details>
        );
      })}

      {state.authorityOwned.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Dados mantidos pelo sistema (somente leitura)</summary>
          <ul className="list-disc space-y-0.5 px-8 pb-3 text-xs text-muted-foreground">
            {state.authorityOwned.map((a) => <li key={a.name}>{a.name} — origem canônica ({a.source}); não editável aqui.</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
