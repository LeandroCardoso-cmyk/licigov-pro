import { useState } from "react";
import PrepFieldControl from "./PrepFieldControl";
import Disclosure from "./Disclosure";
import { type FixAction, type StageTarget } from "@/lib/editalPreparation";
import {
  READINESS_ANCHOR, TR_OFFICIAL_EXACT_MESSAGE, TR_SELECTION_ANCHOR, buildEditalReadiness, isCertameDecision, isDecisionsOpen, isLargeOriginGroup, readinessHeadline,
  type OriginGroup, type ReadinessStep,
} from "@/lib/editalReadiness";
import DecisionFieldset from "./DecisionFieldset";
import UseAsDefaultButton from "./UseAsDefaultButton";
import type { DecisionFormState } from "@/lib/institutionalTemplatesView";
import {
  SOURCE_TITLE, formatDisplay, toFormValue,
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
  /** Escolha inicial da pessoa para a seção de decisões (`null`/ausente ⇒ segue a prontidão: recolhida com bloqueios, aberta quando pronta). */
  initialDecisionsOpen?: boolean | null;
  /** Grupos de origem GRANDES já abertos (padrão: todos recolhidos). Estado só de apresentação — nada é persistido. */
  initialOpenOriginGroups?: readonly string[];
  /** Disclosure dos campos ADICIONAIS do perfil já aberto (padrão: recolhido). */
  initialAdditionalProfileOpen?: boolean;
}

function FixButton({ action, onOpenStage }: { action: FixAction; onOpenStage?: (s: StageTarget) => void }) {
  const cls = "inline-block w-full rounded-lg bg-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground sm:w-auto";
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


/** Um grupo de origem: pequeno ⇒ lista direta; GRANDE (> LARGE_ORIGIN_GROUP_THRESHOLD) ⇒ contagem + ação visíveis e a lista recolhida (Disclosure). */
function OriginGroupBlock({ group, onOpenStage, initialOpen }: { group: OriginGroup; onOpenStage?: (s: StageTarget) => void; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const n = group.items.length;
  const isTr = group.entry === "TR_SECTION";
  const list = <ul className="list-disc pl-5 text-xs">{group.items.map((b) => <li key={b.key}>{b.label} — {b.reason}</li>)}</ul>;
  return (
    <li className="space-y-2" data-origin={group.entry} data-large={isLargeOriginGroup(group) ? "true" : "false"}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.origin}</p>
      {isLargeOriginGroup(group) ? (
        <>
          <p className="text-xs text-foreground" data-count={n}>{isTr ? `${n} parâmetros precisam ser confirmados no TR` : `${n} informações precisam ser corrigidas em ${group.origin}`}</p>
          {group.action && <FixButton action={group.action} onOpenStage={onOpenStage} />}
          <Disclosure id={`edital-origem-${group.entry}`} open={open} onToggle={setOpen} title={isTr ? `Ver ${n} parâmetros` : `Ver ${n} itens`}>{list}</Disclosure>
        </>
      ) : (
        <>
          {list}
          {group.action && <FixButton action={group.action} onOpenStage={onOpenStage} />}
        </>
      )}
    </li>
  );
}

const ICON: Record<"ok" | "todo", string> = { ok: "✓", todo: "!" };
const BTN = "inline-block w-full rounded-lg bg-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground sm:w-auto";

function StepRow({ step, next, children }: { step: ReadinessStep; next: boolean; children?: React.ReactNode }) {
  const tone = step.done ? "border-border" : step.category === "BLOCKING_OFFICIAL_SOURCE_REQUIRED" || step.category === "ACTION_REQUIRED_AT_ORIGIN" ? "border-destructive/50 bg-destructive/5" : "border-amber-500/50 bg-amber-500/5";
  const card = { TR_OFFICIAL: "tr", ONE_TIME_CONFIG: "perfil", ORIGIN: "origens", PROCESS_DECISIONS: "decisoes" }[step.key];
  return (
    <li className={`flex flex-col gap-2 rounded-lg border px-3 py-3 text-sm ${tone}`} data-card={card} data-category={step.category} data-next={next ? "true" : "false"}>
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-emerald-600 text-white" : "bg-amber-500 text-black"}`}>{step.done ? ICON.ok : ICON.todo}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{step.title}{next && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">Próximo passo</span>}</p>
          <p className={step.done ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}><span className="sr-only">{step.done ? "Pronto: " : "Pendente: "}</span>{step.summary}</p>
        </div>
      </div>
      {children}
    </li>
  );
}

/**
 * "Preparação do Edital institucional" — READINESS-FIRST + PROGRESSIVE DISCLOSURE + ZERO_REENTRY.
 * Uma tela, uma progressão: (1) TR oficial exato → (2) configuração única do órgão → (3) dados a corrigir na ORIGEM → (4) decisões DESTE certame.
 * Com pré-requisito bloqueando, as decisões ficam recolhidas (e abrem sozinhas quando as fontes ficam prontas); a pessoa pode abri-las a
 * qualquer momento. O que o sistema já sabe aparece recolhido em "Ver dados reaproveitados"; o detalhe técnico em "Ver detalhes técnicos".
 * Uma confirmação humana registra todas as decisões digitadas (escritas sequenciais pelas autoridades existentes). Nada aqui cria autoridade:
 * a prontidão é um view-model puro derivado do estado que a API já entrega.
 */
export default function EditalPreparationView(p: PreparationViewProps) {
  const { state } = p;
  const [userChoice, setUserChoice] = useState<boolean | null>(p.initialDecisionsOpen ?? null);
  const [additionalOpen, setAdditionalOpen] = useState(p.initialAdditionalProfileOpen ?? false);
  const readiness = buildEditalReadiness(state, p.edits);
  const { counters, details } = readiness;
  const decisionsOpen = isDecisionsOpen(readiness, userChoice);
  const decisions = p.pending.filter(isCertameDecision);
  const scheduleBlock = decisions.filter((i) => i.field.authority === "CERTAME_SCHEDULE");
  const decisionBlock = decisions.filter((i) => i.field.authority !== "CERTAME_SCHEDULE");
  const allFields = state.sections.flatMap((s2) => s2.fields.map((field) => ({ section: s2, field })));
  const derivedSchedule = allFields.filter(({ field }) => field.authority === "CERTAME_SCHEDULE" && field.status === "AUTO");
  const awaitingSchedule = allFields.filter(({ field }) => field.authority === "CERTAME_SCHEDULE" && field.status === "AWAITING");
  const autoFields = allFields.filter(({ field }) => (["AUTO", "ORG_REUSED", "UPSTREAM", "ORG_DEFAULT"] as string[]).includes(field.status));
  const decidedFields = allFields.filter(({ field }) => field.status === "DECIDED");
  const autoCanonical = state.canonicalFields.filter((c) => c.status === "AUTO" && c.authority !== "LIFECYCLE_SYSTEM");
  const systemCanonical = state.canonicalFields.filter((c) => c.status === "AUTO" && c.authority === "LIFECYCLE_SYSTEM");
  const profile = readiness.profile;   // MESMA fonte do contador: lista "O que falta" = ONE_TIME_CONFIGURATION_REQUIRED_TOTAL
  const defaultsApplied = allFields.filter(({ field }) => field.status === "ORG_DEFAULT");
  const eligibleDecided = allFields.filter(({ field }) => field.status === "DECIDED" && field.defaultEligible && field.hasValue).map(({ field }) => field);
  const canSave = p.plan.writes.length > 0 && Object.keys(p.plan.errors).length === 0 && !p.busy;
  const hasDecisionArea = decisions.length > 0 || derivedSchedule.length > 0 || awaitingSchedule.length > 0 || p.optional.length > 0;
  const blocking = readiness.blockingPrerequisites;
  const stepByKey = Object.fromEntries(readiness.steps.map((st) => [st.key, st])) as Record<ReadinessStep["key"], ReadinessStep>;
  const trStep = stepByKey.TR_OFFICIAL; const cfgStep = stepByKey.ONE_TIME_CONFIG; const originStep = stepByKey.ORIGIN; const decStep = stepByKey.PROCESS_DECISIONS;
  const openDecisions = () => {
    setUserChoice(true);
    if (typeof document !== "undefined") document.getElementById("edital-decisoes")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <section id={READINESS_ANCHOR} aria-label="Preparação do Edital institucional" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Preparação do Edital institucional</h2>
        <p className="text-sm text-muted-foreground" data-testid="readiness-headline">{readinessHeadline(counters)}</p>
      </header>

      {/* C. Prontidão / o que falta — UM vocabulário, uma progressão (próximo passo destacado). */}
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label="Prontidão da preparação">
        <StepRow step={trStep} next={readiness.nextStep === "TR_OFFICIAL"}>
          {readiness.tr.status !== "OK" && (
            <div className="space-y-2">
              <p role={state.trPin.state === "INVALID" ? "alert" : "status"} className={`text-xs ${state.trPin.state === "INVALID" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`} data-code={readiness.tr.status}>
                {TR_OFFICIAL_EXACT_MESSAGE}{" "}
                {state.trPin.state === "INVALID"
                  ? (state.trPin.code.startsWith("TR_STRUCTURED_")
                    ? "O Termo de Referência oficial selecionado não corresponde aos parâmetros estruturados atuais. Revise/emita a versão correspondente do TR antes de prosseguir."
                    : "O TR oficial selecionado não é mais válido (existe versão mais recente ou ele divergiu). Selecione o TR oficial exato novamente.")
                  : "Selecione o TR oficial exato: as informações estruturadas do TR são reaproveitadas a partir dele."}
              </p>
              <a href={`#${TR_SELECTION_ANCHOR}`} className={BTN}>Selecionar TR oficial</a>
            </div>
          )}
        </StepRow>
        <StepRow step={cfgStep} next={readiness.nextStep === "ONE_TIME_CONFIG"}>
          {!cfgStep.done && <a href="/configuracoes#perfil-licitacoes" className={BTN}>Configurar agora</a>}
        </StepRow>
        <StepRow step={originStep} next={readiness.nextStep === "ORIGIN"} />
        <StepRow step={decStep} next={readiness.nextStep === "PROCESS_DECISIONS"}>
          {blocking && counters.PROCESS_DECISIONS_TOTAL > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{counters.PROCESS_DECISIONS_TOTAL} {counters.PROCESS_DECISIONS_TOTAL === 1 ? "decisão será necessária" : "decisões serão necessárias"} após resolver as pendências acima.</p>
              {!decisionsOpen && <button type="button" onClick={openDecisions} aria-controls="edital-decisoes" className="w-full rounded-lg border border-input px-3 py-2 text-xs font-medium sm:w-auto">Ver decisões agora</button>}
            </div>
          )}
        </StepRow>
      </ol>

      {readiness.sourcesReady && (
        <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-3 text-sm" data-readiness="READY">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">Fontes e configurações prontas.</p>
          {counters.PROCESS_DECISIONS_TOTAL > 0 && <p className="text-foreground">Agora defina as decisões específicas deste certame.</p>}
        </div>
      )}

      {/* D. Configuração única (somente o que ESTE Edital exige) e ações na origem. */}
      {cfgStep.count > 0 && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-500/40 p-3" aria-label="Perfil institucional de Licitações incompleto">
          <h3 className="text-sm font-semibold text-foreground">Complete a configuração única do órgão</h3>
          <p className="text-xs text-muted-foreground">
            Estes são dados do ÓRGÃO, não do processo — {cfgStep.count} {cfgStep.count === 1 ? "informação necessária para este Edital" : "informações necessárias para este Edital"}
            {details.profileRoles > 0 ? ` (${details.profileRoles} ${details.profileRoles === 1 ? "papel institucional" : "papéis institucionais"} · ${details.profilePolicies} ${details.profilePolicies === 1 ? "política" : "políticas"})` : ""}.
            Configure uma vez; nenhum Edital pede estes dados de novo.
          </p>
          <a href="/configuracoes#perfil-licitacoes" className={BTN}>Configurar agora</a>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">O que falta para este Edital — {profile.required.length}</summary>
            <ul className="mt-1 list-disc pl-5" data-profile-list="required">{profile.required.map((i) => <li key={i.name}>{i.description} — {i.reason}</li>)}</ul>
          </details>
        </div>
      )}
      {profile.additional.length > 0 && (
        <div className="space-y-2" data-profile-additional={profile.additional.length}>
          <p className="text-xs text-muted-foreground">O Perfil institucional possui {profile.additional.length} {profile.additional.length === 1 ? "campo adicional não preenchido" : "campos adicionais não preenchidos"}, não necessário{profile.additional.length === 1 ? "" : "s"} para este Edital.</p>
          <Disclosure id="edital-perfil-adicionais" open={additionalOpen} onToggle={setAdditionalOpen} title="Ver campos adicionais do perfil">
            <ul className="list-disc pl-5 text-xs" data-profile-list="additional">{profile.additional.map((i) => <li key={i.name}>{i.description} — {i.reason}</li>)}</ul>
          </Disclosure>
        </div>
      )}

      {readiness.originGroups.length > 0 && (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" aria-label="Dados a resolver na origem">
          <h3 className="font-semibold text-destructive">Dados a resolver na origem</h3>
          <p className="text-xs text-muted-foreground">Estas informações têm autoridade própria (plataforma, itens, pesquisa de preços, cadastro, TR) e NÃO são digitadas no Edital. Resolva-as na origem; esta tela atualiza em seguida.</p>
          <ul className="space-y-4">
            {readiness.originGroups.map((g) => <OriginGroupBlock key={g.entry} group={g} onOpenStage={p.onOpenStage} initialOpen={p.initialOpenOriginGroups?.includes(g.entry) ?? false} />)}
          </ul>
          {p.onRefresh && <button type="button" onClick={p.onRefresh} className="w-full rounded-lg border border-input px-3 py-2 text-xs sm:w-auto">Já corrigi — atualizar</button>}
        </div>
      )}
      {p.onOpenTr && details.trParametersToConfirm > 0 && !readiness.originGroups.some((g) => g.entry === "TR_SECTION" && g.action) && (
        <button type="button" onClick={p.onOpenTr} className={BTN}>Abrir o TR</button>
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

      {/* E. Decisões deste certame — recolhidas por padrão enquanto houver pré-requisito bloqueando; abrem sozinhas quando as fontes ficam prontas. */}
      {hasDecisionArea && (
        <Disclosure
          id="edital-decisoes" open={decisionsOpen} onToggle={setUserChoice}
          title={`Decisões deste certame — ${counters.PROCESS_DECISIONS_TOTAL}`}
          hint={blocking ? `${counters.PROCESS_DECISIONS_TOTAL} ${counters.PROCESS_DECISIONS_TOTAL === 1 ? "decisão será necessária" : "decisões serão necessárias"} após resolver as pendências acima. Você pode abrir para consultar.` : undefined}
        >
          {scheduleBlock.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Cronograma do certame">
              <h3 className="text-sm font-semibold text-foreground">Cronograma do certame — datas independentes</h3>
              <p className="text-xs text-muted-foreground">Informe só as datas e horários independentes. O que é equivalente técnico só é derivado quando o Perfil da plataforma declara a regra.</p>
              <FieldBlock items={scheduleBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
            </div>
          )}
          {(derivedSchedule.length > 0 || awaitingSchedule.length > 0) && (
            <div className="space-y-2 rounded-lg border border-border p-3" aria-label="Datas e horários derivados">
              <h3 className="text-sm font-semibold text-foreground">Cronograma do certame — datas e horários derivados</h3>
              <ul className="space-y-1 text-xs">
                {derivedSchedule.map(({ field }) => (
                  <li key={field.name} data-derived="true"><span className="text-foreground">{field.description || field.name}:</span> {formatDisplay(field.type, field.displayValue)} <em className="text-muted-foreground">— Derivado automaticamente pela regra configurada no Perfil da plataforma (somente leitura)</em></li>
                ))}
                {awaitingSchedule.map(({ field }) => (
                  <li key={field.name} data-derived="awaiting"><span className="text-foreground">{field.description || field.name}:</span> <em className="text-muted-foreground">{field.origin?.label ?? "aguarda a data independente que o determina"} (somente leitura)</em></li>
                ))}
              </ul>
            </div>
          )}
          {decisionBlock.length > 0 && (
            <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Decisões do certame">
              <h3 className="text-sm font-semibold text-foreground">Decisões deste certame</h3>
              <p className="text-xs text-muted-foreground">Registradas uma vez na Configuração do certame; o Edital e os demais documentos apenas a consomem.</p>
              <FieldBlock items={decisionBlock} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
            </div>
          )}
          {p.optional.length > 0 && (
            <details className="rounded-lg border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Decisões opcionais (ativam campos adicionais) — {p.optional.length}</summary>
              <div className="px-3 pb-3"><FieldBlock items={p.optional} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} /></div>
            </details>
          )}
        </Disclosure>
      )}
      {counters.PROCESS_DECISIONS_TOTAL === 0 && p.plan.writes.length === 0 && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Nenhuma decisão pendente. Verifique o preflight para gerar o Edital.</p>}

      {p.plan.writes.length > 0 && !p.reviewing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <button type="button" disabled={!canSave} onClick={p.onStartReview} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground sm:w-auto">Salvar preparação do Edital</button>
          <span className="text-xs text-muted-foreground">{p.plan.decisionCount} {p.plan.decisionCount === 1 ? "decisão" : "decisões"} para registrar</span>
        </div>
      )}

      {p.reviewing && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Revisar e registrar decisões">
          <p className="text-sm font-semibold">{p.plan.decisionCount} {p.plan.decisionCount === 1 ? "decisão será registrada" : "decisões serão registradas"}:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">{p.plan.writes.flatMap((w) => w.lines.map((l) => <li key={`${w.id}-${l}`}>{l}</li>))}</ul>
          <DecisionFieldset decision={p.decision} onDecision={p.onDecision} showErrors={p.showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO destas decisões (não é preenchimento automático)." />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={p.busy} onClick={p.onConfirm} className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground sm:w-auto">{p.busy ? "Registrando…" : "Confirmar e registrar"}</button>
            <button type="button" disabled={p.busy} onClick={p.onCancelReview} className="w-full rounded-lg border border-input px-4 py-2 text-sm sm:w-auto">Voltar</button>
          </div>
        </div>
      )}

      {defaultsApplied.length > 0 && (
        <details className="rounded-lg border border-border" aria-label="Padrões institucionais aplicados">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Padrões institucionais aplicados — {defaultsApplied.length}</summary>
          <div className="space-y-2 px-3 pb-3">
            <p className="text-xs text-muted-foreground">Definidos por você no Perfil de Licitações. Para mudar apenas neste processo, edite o campo e salve a preparação (vira decisão deste processo).</p>
            <FieldBlock items={defaultsApplied} edits={p.edits} errors={p.fieldErrors} busy={p.busy} onEdit={p.onEdit} />
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

      {/* F. Dados reaproveitados — exatamente AUTO_RESOLVED_TOTAL (nenhum pendente, nenhum oculto, nenhuma decisão humana contada como automática). */}
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver dados reaproveitados — {counters.AUTO_RESOLVED_TOTAL}</summary>
        <ul className="space-y-1 px-3 pb-3 text-sm">
          {autoCanonical.map((c) => (
            <li key={c.name}>
              <details>
                <summary className="cursor-pointer">{c.description || c.name}: <span className="text-muted-foreground">{formatDisplay(c.type, c.displayValue)}</span></summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Origem</dt><dd>{c.origin.label}</dd>{c.origin.ref && <><dt>Referência</dt><dd>{Object.entries(c.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
          {autoFields.map(({ field }) => (
            <li key={field.name}>
              <details>
                <summary className="cursor-pointer">{field.description || field.name}: <span className="text-muted-foreground">{formatDisplay(field.type, field.displayValue)}</span>{field.status === "ORG_REUSED" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Reutilizado do perfil institucional</em>}{field.status === "UPSTREAM" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Reutilizado do TR</em>}{field.status === "ORG_DEFAULT" && <em className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">Padrão institucional</em>}</summary>
                <dl className="ml-4 text-xs text-muted-foreground"><dt>Valor</dt><dd>{formatDisplay(field.type, field.displayValue)}</dd><dt>Origem</dt><dd>{field.origin?.label}</dd><dt>Autoridade</dt><dd>{field.authority}</dd>{field.shadowedLegacy && <><dt>Aviso técnico</dt><dd>Havia um valor legado registrado neste campo; ele foi preservado no histórico e é ignorado porque a autoridade canônica prevalece.</dd></>}{field.origin?.ref && <><dt>Referência</dt><dd>{Object.entries(field.origin.ref).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>}</dl>
              </details>
            </li>
          ))}
          {decidedFields.length > 0 && (
            <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisões já registradas — {decidedFields.length}</li>
          )}
          {decidedFields.map(({ field }) => (
            <li key={field.name}>{field.description || field.name}: <span className="text-muted-foreground">{formatDisplay(field.type, field.displayValue)}</span></li>
          ))}
          {systemCanonical.length > 0 && (
            <li className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atribuídos pelo sistema na emissão — {systemCanonical.length}</li>
          )}
          {systemCanonical.map((c) => (
            <li key={c.name}>{c.description || c.name}: <span className="text-muted-foreground">{formatDisplay(c.type, c.displayValue)}</span></li>
          ))}
        </ul>
      </details>

      {/* G. Detalhes técnicos — decomposição dos contadores (a superfície principal não precisa disto). */}
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Ver detalhes técnicos</summary>
        <div className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
          <p>Catálogo {state.catalogVersion} · revisão {state.revisionId}</p>
          <p>CAS: Configuração do certame {state.revisions.process} · órgão {state.revisions.organization} · orçamento {state.revisions.budget}</p>
          <p>Contadores: obtidos automaticamente {counters.AUTO_RESOLVED_TOTAL} (campos {details.autoFromFields} + autoridades canônicas {details.autoFromCanonicalAuthorities}) · pendências na origem {counters.ORIGIN_ACTION_REQUIRED_TOTAL} (dados {details.sourceIssues} + parâmetros do TR {details.trParametersToConfirm} + TR oficial {details.trOfficialRequired ? 1 : 0}) · configuração única {counters.ONE_TIME_CONFIGURATION_REQUIRED_TOTAL} · decisões do certame {counters.PROCESS_DECISIONS_TOTAL} (datas independentes {details.scheduleIndependent}; derivadas {details.scheduleDerived})</p>
          <p>Campos do modelo: {state.metrics.TOTAL_TEMPLATE_FIELDS} · decisões já registradas {details.decisionsRegistered} · condicionais ocultos {details.conditionalHidden} · pós-homologação {details.postAwardHidden} · atribuídos na emissão {details.systemAtIssuance} · perfil necessário a este Edital {details.requiredForCurrentDocument} · perfil adicional não preenchido {details.profileGlobalIncomplete}</p>
          <ul className="list-disc pl-5">{decisions.map(({ field }) => <li key={field.name} className="font-mono">{field.name} ← {field.source}.{field.path} ({field.type})</li>)}</ul>
        </div>
      </details>
    </section>
  );
}
