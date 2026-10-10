import PrepFieldControl from "./PrepFieldControl";
import { fixAction, sourceIssues, type FixAction, type StageTarget } from "@/lib/editalPreparation";
import DecisionFieldset from "./DecisionFieldset";
import UseAsDefaultButton from "./UseAsDefaultButton";
import type { DecisionFormState } from "@/lib/institutionalTemplatesView";
import {
  SOURCE_TITLE, formatDisplay, orgProfilePending, reusedItems, toFormValue, trParamsPending,
  type FormValue, type PendingItem, type PrepField, type PreparationStateView, type SaveOutcome, type SavePlan, type SectionEdits,
} from "@/lib/editalPreparation";

export interface PreparationViewProps {
  state: PreparationStateView;
  edits: Readonly<Record<string, SectionEdits>>;
  fieldErrors: Readonly<Record<string, Record<string, string>>>;
  /** Pendências/opcionais AO VIVO (condicionais já aplicadas às edições). */
  pending: readonly PendingItem[];
  optional: readonly PendingItem[];
  onEdit: (source: string, field: PrepField, value: FormValue) => void;
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
  /** Abre o TR do processo (onde os Parâmetros estruturados são informados). */
  onOpenTr?: () => void;
  /** Abre a etapa do processo onde o dado é resolvido (Itens, Pesquisa de Preços, DFD, TR). */
  onOpenStage?: (stage: StageTarget) => void;
  /** Recarrega a preparação depois de a pessoa corrigir o dado na origem. */
  onRefresh?: () => void;
  processId?: string;
}

function FixButton({ action, onOpenStage }: { action: FixAction; onOpenStage?: (s: StageTarget) => void }) {
  const cls = "inline-block rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground";
  if (action.href) return <a href={action.href} className={cls}>{action.label}</a>;
  if (action.stage && onOpenStage) return <button type="button" onClick={() => onOpenStage(action.stage!)} className={cls}>{action.label}</button>;
  return null;
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
  const procBlock = p.pending.filter((i) => i.section.scope === "PROCESS");
  // Só decisões GENUINAMENTE independentes do certame: divulgação do orçamento e regime de participação vêm das origens (Pesquisa de Preços / Itens).
  const pendingCount = p.pending.length;
  const scheduleBlock = procBlock.filter((i) => i.field.authority === "CERTAME_SCHEDULE");
  const decisionBlock = procBlock.filter((i) => i.field.authority !== "CERTAME_SCHEDULE");
  const issues = sourceIssues(state);
  const issuesByAction = [...new Map(issues.map((i) => [fixAction(i.entry)?.label ?? "—", i.entry])).entries()];
  const reused = reusedItems(state);
  const profilePending = orgProfilePending(state);
  const trPending = trParamsPending(state);
  const m = state.metrics;
  const reusedProfile = (m.ORG_ROLES_REUSED ?? 0) + (m.ORG_POLICIES_REUSED ?? 0) + (m.ORG_REUSED - (m.ORG_ROLES_REUSED ?? 0) - (m.ORG_POLICIES_REUSED ?? 0) > 0 ? m.ORG_REUSED - (m.ORG_ROLES_REUSED ?? 0) - (m.ORG_POLICIES_REUSED ?? 0) : 0);
  const by = m.BY_AUTHORITY ?? {};
  const upstreamCount = (by.UPSTREAM_PROCESS ?? 0) + (by.UPSTREAM_DFD ?? 0) + (by.UPSTREAM_ETP ?? 0) + (by.EXISTING_CANONICAL ?? 0);
  const defaultsApplied = state.sections.flatMap((s2) => s2.fields).filter((f) => f.status === "ORG_DEFAULT");
  const eligibleDecided = state.sections.flatMap((s2) => s2.fields).filter((f) => f.status === "DECIDED" && f.defaultEligible && f.hasValue);
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

      {state.trPin.state !== "VALID" && (
        <p role={state.trPin.state === "INVALID" ? "alert" : "status"} className={`text-sm ${state.trPin.state === "INVALID" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
          {state.trPin.state === "INVALID"
            ? (state.trPin.code.startsWith("TR_STRUCTURED_")
              ? "O Termo de Referência oficial selecionado não corresponde aos parâmetros estruturados atuais. Revise/emita a versão correspondente do TR antes de prosseguir."
              : "O TR oficial selecionado não é mais válido (existe versão mais recente ou ele divergiu). Selecione o TR oficial exato novamente.")
            : "Selecione o TR oficial exato: as informações estruturadas do TR são reaproveitadas a partir dele."}
        </p>
      )}

      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Resumo da preparação">
        <li className={`rounded-lg border px-3 py-2 text-sm ${profilePending.length ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`} data-card="perfil">
          <p className="font-medium text-foreground">Configuração única do órgão</p>
          {profilePending.length ? <p className="text-amber-700 dark:text-amber-300">⚠ incompleto</p>
            : <p className="text-emerald-700 dark:text-emerald-300">✓ {reusedProfile} reutilizados{state.orgProfile ? ` · revisão ${state.orgProfile.revision}` : ""}</p>}
        </li>
        <li className="rounded-lg border border-border px-3 py-2 text-sm" data-card="processo">
          <p className="font-medium text-foreground">Processo / DFD / ETP</p>
          <p className="text-emerald-700 dark:text-emerald-300">✓ {upstreamCount} dados do processo e do cadastro</p>
        </li>
        <li className={`rounded-lg border px-3 py-2 text-sm ${trPending.length || state.trPin.state !== "VALID" ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`} data-card="tr">
          <p className="font-medium text-foreground">TR oficial e parâmetros</p>
          {state.trPin.state !== "VALID" ? <p className="text-amber-700 dark:text-amber-300">⚠ selecione o TR oficial</p>
            : trPending.length ? <p className="text-amber-700 dark:text-amber-300">⚠ {trPending.length} parâmetro(s) a confirmar no TR</p>
              : <p className="text-emerald-700 dark:text-emerald-300">✓ {(m.UPSTREAM_TR_REUSED ?? 0) + m.TR_PROJECTED} reutilizados do TR</p>}
        </li>
        <li className={`rounded-lg border px-3 py-2 text-sm ${issues.length ? "border-destructive/50 bg-destructive/5" : "border-border"}`} data-card="origens">
          <p className="font-medium text-foreground">Plataforma, itens e orçamento</p>
          {issues.length ? <p className="text-destructive">⚠ {issues.length} dado(s) a resolver na origem</p>
            : <p className="text-emerald-700 dark:text-emerald-300">✓ {(m.AUTO_FROM_PLATFORM ?? 0) + (m.AUTO_FROM_ITEMS ?? 0) + (m.AUTO_FROM_PRICE_RESEARCH ?? 0)} derivados da plataforma, dos itens e da pesquisa</p>}
        </li>
        <li className={`rounded-lg border px-3 py-2 text-sm ${pendingCount > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-border"}`} data-card="decisoes">
          <p className="font-medium text-foreground">Decisões deste certame</p>
          {pendingCount > 0 ? <p className="text-amber-700 dark:text-amber-300">⚠ {pendingCount} {pendingCount === 1 ? "decisão pendente" : "decisões pendentes"}</p> : <p className="text-emerald-700 dark:text-emerald-300">✓ nenhuma pendente</p>}
        </li>
        {defaultsApplied.length > 0 && (
          <li className="rounded-lg border border-border px-3 py-2 text-sm" data-card="padroes">
            <p className="font-medium text-foreground">Padrões institucionais</p>
            <p className="text-emerald-700 dark:text-emerald-300">✓ {defaultsApplied.length} aplicado(s) — alteráveis neste processo</p>
          </li>
        )}
      </ul>

      {profilePending.length > 0 && (
        <div role="status" className="space-y-1 rounded-lg border border-amber-500/40 p-3" aria-label="Perfil institucional de Licitações incompleto">
          <h3 className="text-sm font-semibold text-foreground">Complete a configuração única do órgão</h3>
          <p className="text-xs text-muted-foreground">Estes são dados do ÓRGÃO, não do processo — {profilePending.length} {profilePending.length === 1 ? "campo pendente" : "campos pendentes"}. Configure uma vez; nenhum Edital pede estes dados de novo.</p>
          <a href="/configuracoes#perfil-licitacoes" className="inline-block rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Configurar agora</a>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">O que falta</summary>
            <ul className="mt-1 list-disc pl-5">{profilePending.map((i) => <li key={i.name}>{i.description || i.name} — {i.reason}</li>)}</ul>
          </details>
        </div>
      )}

      {trPending.length > 0 && state.trPin.state === "VALID" && (
        <div role="status" className="space-y-1 rounded-lg border border-amber-500/40 p-3" aria-label="Parâmetros estruturados do TR pendentes">
          <h3 className="text-sm font-semibold text-foreground">Parâmetros estruturados do TR pendentes</h3>
          <p className="text-xs text-muted-foreground">{trPending.length} {trPending.length === 1 ? "parâmetro depende" : "parâmetros dependem"} do TR (prazos, local de entrega, pagamento, garantias, qualificação…). Informe uma vez no TR; o Edital reaproveita.</p>
          {p.onOpenTr && <button type="button" onClick={p.onOpenTr} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">Abrir o TR</button>}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">O que falta</summary>
            <ul className="mt-1 list-disc pl-5">{trPending.map((i) => <li key={i.name}>{i.description || i.name}{i.reason ? ` — ${i.reason}` : ""}</li>)}</ul>
          </details>
        </div>
      )}

      {p.notice && (
        <p role={p.notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${p.notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : p.notice.kind === "stale" ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>{p.notice.text}</p>
      )}
      {p.outcome && (p.outcome.registered.length > 0 || p.outcome.failed) && (
        <div role={p.outcome.failed ? "alert" : "status"} className="rounded-lg border border-border px-3 py-2 text-sm">
          {p.outcome.registered.length > 0 && <p>Já registrado: {p.outcome.registered.map((w) => (w.source ? SOURCE_TITLE[w.source] ?? w.source : "Configuração do certame")).join(", ")}.</p>}
          {p.outcome.failed && <p className="text-destructive">Parou em {p.outcome.failed.write.source ? SOURCE_TITLE[p.outcome.failed.write.source] ?? p.outcome.failed.write.source : "Configuração do certame"}: nada foi sobrescrito. {p.outcome.notExecuted.length > 0 ? `${p.outcome.notExecuted.length} registro(s) não executado(s) — revise e confirme novamente.` : ""}</p>}
        </div>
      )}

      {issues.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" aria-label="Dados a resolver na origem">
          <h3 className="font-semibold text-destructive">Dados a resolver na origem</h3>
          <p className="text-xs text-muted-foreground">Estas informações têm autoridade própria (plataforma, itens, pesquisa de preços, cadastro) e NÃO são digitadas no Edital. Resolva-as na origem; esta tela atualiza em seguida.</p>
          <ul className="list-disc pl-5 text-xs">{issues.map((b) => <li key={b.key}>{b.label} — {b.reason}</li>)}</ul>
          <div className="flex flex-wrap items-center gap-2">
            {issuesByAction.map(([label, entry]) => { const a = fixAction(entry); return a ? <FixButton key={label} action={a} onOpenStage={p.onOpenStage} /> : null; })}
            {p.onRefresh && <button type="button" onClick={p.onRefresh} className="rounded-lg border border-input px-3 py-1.5 text-xs">Já corrigi — atualizar</button>}
          </div>
        </div>
      )}

      {scheduleBlock.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Cronograma do certame">
          <h3 className="text-sm font-semibold text-foreground">Cronograma do certame</h3>
          <p className="text-xs text-muted-foreground">Informe só as datas e horários independentes. O que é equivalente técnico só é derivado quando o Perfil da plataforma declara a regra.</p>
          <FieldBlock items={scheduleBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
        </div>
      )}
      {decisionBlock.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Decisões do certame">
          <h3 className="text-sm font-semibold text-foreground">Decisões deste certame</h3>
          <p className="text-xs text-muted-foreground">Registradas uma vez na Configuração do certame; o Edital e os demais documentos apenas a consomem.</p>
          <FieldBlock items={decisionBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
        </div>
      )}
      {pendingCount === 0 && p.plan.writes.length === 0 && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Nenhuma decisão pendente. Verifique o preflight para gerar o Edital.</p>}

      {p.optional.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Decisões opcionais (ativam campos adicionais) — {p.optional.length}</summary>
          <div className="px-3 pb-3"><FieldBlock items={p.optional} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} /></div>
        </details>
      )}

      {defaultsApplied.length > 0 && (
        <details className="rounded-lg border border-border" aria-label="Padrões institucionais aplicados">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Padrões institucionais aplicados — {defaultsApplied.length}</summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-xs text-muted-foreground">Definidos por você no Perfil de Licitações. Para mudar apenas neste processo, edite o campo e salve a preparação (vira decisão deste processo).</p>
            <FieldBlock items={state.sections.flatMap((section) => section.fields.filter((f) => f.status === "ORG_DEFAULT").map((field) => ({ section, field })))} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
          </div>
        </details>
      )}

      {eligibleDecided.length > 0 && (
        <details className="rounded-lg border border-border" aria-label="Decisões que podem virar padrão institucional">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Usar como padrão institucional nos próximos processos — {eligibleDecided.length}</summary>
          <ul className="space-y-2 px-3 pb-3 text-sm">
            {eligibleDecided.map((f) => (
              <li key={f.name} className="space-y-1">
                <p>{f.description || f.name}: <strong>{formatDisplay(f.type, f.displayValue ?? f.currentValue)}</strong></p>
                <UseAsDefaultButton name={f.name} description={f.description || f.name} type={f.type} value={f.currentValue} processId={p.processId} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver dados reaproveitados — {reused.length + state.canonicalFields.length}</summary>
        <ul className="space-y-1 px-3 pb-3 text-sm">
          {state.canonicalFields.map((c) => (
            <li key={c.name}>
              <details>
                <summary className="cursor-pointer">{c.description || c.name}: <span className="text-muted-foreground">{c.status === "AUTO" ? formatDisplay(c.type, c.displayValue) : "a resolver na origem"}</span></summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Origem</dt><dd>{c.origin.label}</dd>{c.origin.ref && <><dt>Referência</dt><dd>{Object.entries(c.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
          {reused.map(({ field }) => (
            <li key={field.name}>
              <details>
                <summary className="cursor-pointer">{field.description || field.name}: <span className="text-muted-foreground">{formatDisplay(field.type, field.displayValue)}</span>{field.status === "ORG_REUSED" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Reutilizado do perfil institucional</em>}{field.status === "UPSTREAM" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Reutilizado do TR</em>}{field.status === "ORG_DEFAULT" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Padrão institucional</em>}</summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Valor</dt><dd>{formatDisplay(field.type, field.displayValue)}</dd><dt>Origem</dt><dd>{field.origin?.label}</dd><dt>Autoridade</dt><dd>{field.authority}</dd>{field.shadowedLegacy && <><dt>Aviso técnico</dt><dd>Havia um valor legado registrado neste campo; ele foi preservado no histórico e é ignorado porque a autoridade canônica prevalece.</dd></>}{field.origin?.ref && <><dt>Referência</dt><dd>{Object.entries(field.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver detalhes técnicos</summary>
        <div className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
          <p>Catálogo {state.catalogVersion} · revisão {state.revisionId}</p>
          <p>CAS: Configuração do certame {state.revisions.process} · órgão {state.revisions.organization} · orçamento {state.revisions.budget}</p>
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
          <DecisionFieldset decision={p.decision} onDecision={p.onDecision} showErrors={p.showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO destas decisões (não é preenchimento automático)." />
          <div className="flex gap-2">
            <button type="button" disabled={p.busy} onClick={p.onConfirm} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{p.busy ? "Registrando…" : "Confirmar e registrar"}</button>
            <button type="button" disabled={p.busy} onClick={p.onCancelReview} className="rounded-lg border border-input px-4 py-2 text-sm">Voltar</button>
          </div>
        </div>
      )}
    </section>
  );
}

