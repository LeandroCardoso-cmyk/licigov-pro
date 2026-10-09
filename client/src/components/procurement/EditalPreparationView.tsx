import PrepFieldControl from "./PrepFieldControl";
import { validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";
import {
  SOURCE_TITLE, formatDisplay, reusedItems, toFormValue,
  type FormValue, type PendingItem, type PrepField, type PreparationStateView, type SaveOutcome, type SavePlan, type SectionEdits, type SummaryGroup,
} from "@/lib/editalPreparation";

export interface PreparationViewProps {
  state: PreparationStateView;
  edits: Readonly<Record<string, SectionEdits>>;
  fieldErrors: Readonly<Record<string, Record<string, string>>>;
  /** Pendências/opcionais AO VIVO (condicionais já aplicadas às edições). */
  pending: readonly PendingItem[];
  optional: readonly PendingItem[];
  onEdit: (source: string, field: PrepField, value: FormValue) => void;
  disclosure: "" | "publico" | "sigiloso";
  onDisclosure: (v: "publico" | "sigiloso") => void;
  participationDefault: string | null;
  onParticipationDefault: (v: string) => void;
  plan: SavePlan;
  reviewing: boolean;
  onStartReview: () => void;
  onCancelReview: () => void;
  decision: DecisionFormState;
  onDecision: (d: DecisionFormState) => void;
  showErrors: boolean;
  busy: boolean;
  outcome: SaveOutcome | null;
  notice: { kind: "ok" | "error" | "stale"; text: string } | null;
  onConfirm: () => void;
}

const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

function GroupCard({ g, profileRevision }: { g: SummaryGroup; profileRevision: number | null }) {
  const org = g.id === "institucional" || g.id === "politicas";
  const done = g.pending === 0 && g.blockedCanonical === 0;
  return (
    <li className={`rounded-lg border px-3 py-2 text-sm ${g.pending > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`} data-group={g.id}>
      <p className="font-medium text-foreground">{g.title}</p>
      {g.pending > 0
        ? <p className="text-amber-700 dark:text-amber-300">⚠ {g.pending} {g.pending === 1 ? "pendência" : "pendências"}</p>
        : g.blockedCanonical > 0
          ? <p className="text-destructive">⚠ {g.blockedCanonical} dado(s) do sistema incompleto(s)</p>
          : <p className="text-emerald-700 dark:text-emerald-300">✓ {g.resolved}/{g.total}{org && done && profileRevision !== null ? " · perfil institucional vigente" : ""}</p>}
    </li>
  );
}

function FieldBlock({ items, edits, errors, busy, onEdit }: { items: readonly PendingItem[]; edits: PreparationViewProps["edits"]; errors: PreparationViewProps["fieldErrors"]; busy: boolean; onEdit: PreparationViewProps["onEdit"] }) {
  const sources = [...new Set(items.map((i) => i.section.source))];
  return (
    <div className="space-y-4">
      {sources.map((src) => (
        <div key={src} className="space-y-3" data-source={src}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SOURCE_TITLE[src] ?? src}</h4>
          {items.filter((i) => i.section.source === src).map(({ field }) => (
            <PrepFieldControl key={field.path} field={field} value={edits[src]?.[field.path] ?? toFormValue(field, field.currentValue)}
              error={errors[src]?.[field.path]} disabled={busy} onChange={(v) => onEdit(src, field, v)} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * "Preparação do Edital institucional" (ZERO_REENTRY): resumo operacional + SÓ as pendências. O que o sistema já sabe aparece
 * recolhido ("Ver dados reaproveitados") com valor e origem; o detalhe técnico fica em "Ver detalhes técnicos". Uma confirmação
 * humana registra todas as decisões digitadas (as escritas reais são sequenciais, pelas autoridades existentes).
 */
export default function EditalPreparationView(p: PreparationViewProps) {
  const { state } = p;
  const orgBlock = p.pending.filter((i) => i.section.scope === "ORG");
  const procBlock = p.pending.filter((i) => i.section.scope === "PROCESS");
  const dErr = validateDecisionForm(p.decision).errors;
  const pendingCount = p.pending.length + (state.budgetDisclosure || p.disclosure ? 0 : 1) + (state.participationPending && !p.participationDefault?.trim() ? 1 : 0);
  const reused = reusedItems(state);
  // Perfil institucional (ORG): editável em um só lugar; mudar cria nova revisão do órgão e vale para os NOVOS processos.
  const profileItems: PendingItem[] = state.sections.filter((s) => s.scope === "ORG").flatMap((section) =>
    section.fields.filter((f) => f.editable && ["ORG_REUSED", "OPTIONAL"].includes(f.status)).map((field) => ({ section, field })));
  const canSave = p.plan.writes.length > 0 && Object.keys(p.plan.errors).length === 0 && !p.busy;

  return (
    <section aria-label="Preparação do Edital institucional" className="space-y-4 rounded-xl border border-border bg-card p-5">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Preparação do Edital institucional</h2>
        <p className="text-sm text-muted-foreground">
          <strong>{state.summary.reusedAutomatically}</strong> informações reaproveitadas automaticamente ·{" "}
          <strong>{pendingCount}</strong> {pendingCount === 1 ? "decisão ainda precisa" : "decisões ainda precisam"} de você
        </p>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Resumo da preparação">
        {state.summary.groups.map((g) => <GroupCard key={g.id} g={g} profileRevision={state.orgProfile?.revision ?? null} />)}
      </ul>

      {p.notice && (
        <p role={p.notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${p.notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : p.notice.kind === "stale" ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>{p.notice.text}</p>
      )}
      {p.outcome && (p.outcome.registered.length > 0 || p.outcome.failed) && (
        <div role={p.outcome.failed ? "alert" : "status"} className="rounded-lg border border-border px-3 py-2 text-sm">
          {p.outcome.registered.length > 0 && <p>Já registrado: {p.outcome.registered.map((w) => (w.source ? SOURCE_TITLE[w.source] ?? w.source : "Divulgação do orçamento")).join(", ")}.</p>}
          {p.outcome.failed && <p className="text-destructive">Parou em {p.outcome.failed.write.source ? SOURCE_TITLE[p.outcome.failed.write.source] ?? p.outcome.failed.write.source : "Divulgação do orçamento"}: nada foi sobrescrito. {p.outcome.notExecuted.length > 0 ? `${p.outcome.notExecuted.length} registro(s) não executado(s) — revise e confirme novamente.` : ""}</p>}
        </div>
      )}

      {orgBlock.length > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 p-3" aria-label="Configuração institucional pendente">
          <h3 className="text-sm font-semibold text-foreground">Configuração institucional pendente</h3>
          <p className="text-xs text-muted-foreground">Registre UMA vez para o órgão: os próximos Editais reutilizam estes dados e não pedem de novo.</p>
          <FieldBlock items={orgBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
        </div>
      )}

      {(procBlock.length > 0 || !state.budgetDisclosure || state.participationPending) && (
        <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Decisões do certame">
          <h3 className="text-sm font-semibold text-foreground">Decisões deste processo</h3>
          {!state.budgetDisclosure && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Divulgação do orçamento <span className="text-destructive">*</span></legend>
              <div className="flex gap-4 text-sm">
                {(["publico", "sigiloso"] as const).map((o) => (
                  <label key={o} className="flex items-center gap-1"><input type="radio" name="edital-disclosure" checked={p.disclosure === o} onChange={() => p.onDisclosure(o)} />{o === "publico" ? "Público" : "Sigiloso"}</label>
                ))}
              </div>
            </fieldset>
          )}
          {state.participationPending && (
            <label className="flex flex-col text-sm">
              <span className="mb-1 font-medium">Regime de participação padrão dos itens <span className="text-destructive">*</span></span>
              <input type="text" className={INPUT} value={p.participationDefault ?? ""} onChange={(e) => p.onParticipationDefault(e.target.value)} />
            </label>
          )}
          <FieldBlock items={procBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
        </div>
      )}
      {pendingCount === 0 && p.plan.writes.length === 0 && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Nenhuma decisão pendente. Verifique o preflight para gerar o Edital.</p>}

      {p.optional.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Decisões opcionais (ativam campos adicionais) — {p.optional.length}</summary>
          <div className="px-3 pb-3"><FieldBlock items={p.optional} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} /></div>
        </details>
      )}

      {profileItems.length > 0 && (
        <details className="rounded-lg border border-border" aria-label="Perfil institucional para Editais">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Perfil institucional para Editais{state.orgProfile ? ` — revisão ${state.orgProfile.revision}` : ""}</summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-xs text-muted-foreground">Dados estáveis do órgão, registrados uma vez e reutilizados em todo novo Edital. Alterar cria uma nova revisão do perfil; Editais já gerados mantêm a revisão que usaram.</p>
            <FieldBlock items={profileItems} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
          </div>
        </details>
      )}

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver dados reaproveitados — {reused.length + state.canonicalFields.length}</summary>
        <ul className="space-y-1 px-3 pb-3 text-sm">
          {state.canonicalFields.map((c) => (
            <li key={c.name}>
              <details>
                <summary className="cursor-pointer">{c.description || c.name}: <span className="text-muted-foreground">{c.status === "AUTO" ? formatDisplay(c.type, c.displayValue) : "aguardando"}</span></summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Origem</dt><dd>{c.origin.label}</dd>{c.origin.ref && <><dt>Referência</dt><dd>{Object.entries(c.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
          {reused.map(({ field }) => (
            <li key={field.name}>
              <details>
                <summary className="cursor-pointer">{field.description || field.name}: <span className="text-muted-foreground">{formatDisplay(field.type, field.displayValue)}</span>{field.status === "ORG_REUSED" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Reutilizado do perfil institucional</em>}</summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Valor</dt><dd>{formatDisplay(field.type, field.displayValue)}</dd><dt>Origem</dt><dd>{field.origin?.label}</dd>{field.origin?.ref && <><dt>Referência</dt><dd>{Object.entries(field.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver detalhes técnicos</summary>
        <div className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
          <p>Catálogo {state.catalogVersion} · revisão {state.revisionId}</p>
          <p>CAS: processo {state.revisions.process} · órgão {state.revisions.organization} · orçamento {state.revisions.budget}</p>
          <p>Campos do modelo: {state.metrics.TOTAL_TEMPLATE_FIELDS} · automáticos {state.metrics.AUTO_RESOLVED + state.metrics.TR_PROJECTED} · perfil do órgão {state.metrics.ORG_REUSED} · decisões registradas {state.metrics.DECIDED} · condicionais ocultos {state.metrics.CONDITIONAL_HIDDEN} · pós-homologação {state.metrics.POST_AWARD_HIDDEN} · decisões visíveis {state.metrics.MANUAL_DECISIONS_VISIBLE}</p>
          <ul className="list-disc pl-5">{p.pending.map(({ field }) => <li key={field.name} className="font-mono">{field.name} ← {field.source}.{field.path} ({field.type})</li>)}</ul>
        </div>
      </details>

      {p.plan.writes.length > 0 && !p.reviewing && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!canSave} onClick={p.onStartReview} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">Salvar preparação do Edital</button>
          <span className="text-xs text-muted-foreground">{p.plan.decisionCount} {p.plan.decisionCount === 1 ? "decisão" : "decisões"} para registrar</span>
        </div>
      )}

      {p.reviewing && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Revisar e registrar decisões">
          <p className="text-sm font-semibold">{p.plan.decisionCount} {p.plan.decisionCount === 1 ? "decisão será registrada" : "decisões serão registradas"}:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">{p.plan.writes.flatMap((w) => w.lines.map((l) => <li key={`${w.id}-${l}`}>{l}</li>))}</ul>
          <fieldset className="space-y-2 text-xs">
            <legend className="px-1 font-medium">Autoridade humana</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([["decidedByName", "Autoridade que decidiu (nome)", "text"], ["decidedByRole", "Cargo / função", "text"], ["decidedAt", "Data do ato", "date"], ["basisReference", "Referência do ato (portaria, ata, processo)", "text"]] as const).map(([k, label, type]) => (
                <label key={k} className="flex flex-col"><span className="mb-1 font-medium">{label}</span>
                  <input type={type} value={p.decision[k]} className={INPUT} onChange={(e) => p.onDecision({ ...p.decision, [k]: e.target.value })} />
                  {p.showErrors && dErr[k] && <span role="alert" className="text-destructive">{dErr[k]}</span>}
                </label>
              ))}
            </div>
            <label className="flex flex-col"><span className="mb-1 font-medium">Justificativa (mín. 10 caracteres)</span>
              <textarea rows={2} value={p.decision.reason} className={INPUT} onChange={(e) => p.onDecision({ ...p.decision, reason: e.target.value })} />
              {p.showErrors && dErr.reason && <span role="alert" className="text-destructive">{dErr.reason}</span>}
            </label>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={p.decision.confirmed} onChange={(e) => p.onDecision({ ...p.decision, confirmed: e.target.checked })} />
              <span>Confirmo, como pessoa responsável, o REGISTRO destas decisões (não é preenchimento automático).</span></label>
            {p.showErrors && dErr.confirmed && <p role="alert" className="text-destructive">{dErr.confirmed}</p>}
          </fieldset>
          <div className="flex gap-2">
            <button type="button" disabled={p.busy} onClick={p.onConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{p.busy ? "Registrando…" : "Confirmar e registrar"}</button>
            <button type="button" disabled={p.busy} onClick={p.onCancelReview} className="rounded-lg border border-input px-4 py-2 text-sm">Voltar</button>
          </div>
        </div>
      )}
    </section>
  );
}

