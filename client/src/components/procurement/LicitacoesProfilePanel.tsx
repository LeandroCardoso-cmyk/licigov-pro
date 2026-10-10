import { useMemo, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import PrepFieldControl from "./PrepFieldControl";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import {
  buildRoles, changedRoles, emptyRoleForm, profileAsPrepView, roleToForm, withoutDefault,
  type ProfileStateView, type RoleAssignmentView, type RoleForm,
} from "@/lib/contextReuse";
import {
  STALE_NOTICE, buildSavePlan, executeSavePlan, formatDisplay, isStaleSave, toFormValue, type FormValue, type PlannedWrite, type PrepField, type SectionEdits,
} from "@/lib/editalPreparation";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";

const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
const SOURCE_TITLE: Record<string, string> = { IDENTITY: "Identidade e canais do órgão", POLICY: "Políticas do órgão" };
const STATE_LABEL: Record<string, string> = { OK: "designado", MISSING: "não designado", STALE: "vencido" };

/**
 * "Perfil institucional de Licitações" (Configurações): papéis (nome, cargo, ato/portaria/delegação, data de referência, vigência),
 * políticas estáveis do órgão e padrões institucionais. Configuração ÚNICA por órgão; mudar cria NOVA revisão (Editais já gerados
 * mantêm a que usaram). Mesmo ledger do perfil do órgão; escritas sequenciais com CAS encadeado.
 */
export default function LicitacoesProfilePanel() {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.licitacoesProfile.useQuery({});
  const recordOrg = trpc.institutionalTemplates.governed.recordOrganizationFields.useMutation();
  const recordProfile = trpc.institutionalTemplates.governed.recordLicitacoesProfile.useMutation();
  const data = query.data as { status: "UNAVAILABLE"; reason: string } | ProfileStateView | undefined;
  const state = data?.status === "READY" ? data : undefined;

  const [roleForms, setRoleForms] = useState<Record<string, RoleForm>>({});
  const [edits, setEdits] = useState<Record<string, SectionEdits>>({});
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "stale"; text: string } | null>(null);
  const keys = useRef<Record<string, string>>({});

  const formOf = (role: string, a: RoleAssignmentView | null): RoleForm => roleForms[role] ?? roleToForm(a);
  const roleBuild = useMemo(() => {
    if (!state) return { roles: {}, errors: {}, changed: [] as string[] };
    const merged = Object.fromEntries(state.roles.map((r) => [r.role, formOf(r.role, r.assignment)]));
    const built = buildRoles(merged);
    const current = Object.fromEntries(state.roles.map((r) => [r.role, r.assignment]));
    return { ...built, changed: changedRoles(current, built.roles) };
  }, [state, roleForms]);
  const plan = useMemo(() => (state ? buildSavePlan(profileAsPrepView(state), { edits, disclosure: "", participationDefault: null }) : { writes: [], errors: {}, decisionCount: 0 }), [state, edits]);

  if (!data) return query.isLoading ? <p className="text-sm text-muted-foreground">Carregando o Perfil de Licitações…</p> : null;
  if (!state) return <p className="text-sm text-muted-foreground">{(data as { reason: string }).reason}</p>;

  const total = plan.decisionCount + roleBuild.changed.length;
  const canSave = total > 0 && Object.keys(plan.errors).length === 0 && Object.keys(roleBuild.errors).length === 0 && !busy;
  const needed = state.roles.filter((r) => r.usedBy.length > 0);
  const others = state.roles.filter((r) => r.usedBy.length === 0);

  const onEdit = (source: string, f: PrepField, v: FormValue) => setEdits((p) => ({ ...p, [source]: { ...(p[source] ?? {}), [f.path]: v } }));
  const setRole = (role: string, a: RoleAssignmentView | null, patch: Partial<RoleForm>) => setRoleForms((p) => ({ ...p, [role]: { ...formOf(role, a), ...patch } }));

  const save = async () => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid || total === 0) return;
    const act = { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() };
    const key = (id: string) => (keys.current[id] ??= crypto.randomUUID());
    setBusy(true); setNotice(null);
    const isStale = (e: unknown) => isStaleSave((e as { data?: { code?: string } }).data?.code, e instanceof Error ? e.message : String(e));
    try {
      let revision = state.revision;
      if (plan.writes.length > 0) {
        const out = await executeSavePlan(plan.writes, { organization: revision, process: 0, budget: 0 }, {
          async write(w: PlannedWrite, expectedRevision: number) {
            const r = await recordOrg.mutateAsync({ confirm: true, idempotencyKey: key(w.id), decision: act, expectedRevision, catalogVersion: state.catalogVersion, source: w.source as "POLICY" | "IDENTITY", fields: w.fields ?? {} });
            revision = r.decision.revision;
            return { revision: r.decision.revision };
          },
        }, isStale);
        if (out.failed) {
          if (out.failed.stale) { keys.current = {}; setNotice({ kind: "stale", text: STALE_NOTICE }); }
          else setNotice({ kind: "error", text: domainErrorMessage(out.failed.message, "Não foi possível registrar.") });
          await utils.procurementProcess.licitacoesProfile.invalidate();
          return;
        }
      }
      if (roleBuild.changed.length > 0) {
        const r = await recordProfile.mutateAsync({ confirm: true, idempotencyKey: key("roles"), decision: act, expectedRevision: revision, catalogVersion: state.catalogVersion, roles: roleBuild.roles } as never);
        revision = r.decision.revision;
      }
      keys.current = {}; setEdits({}); setRoleForms({}); setReviewing(false); setDecision((d) => ({ ...d, confirmed: false }));
      setNotice({ kind: "ok", text: `Perfil registrado (revisão ${revision}). Os próximos Editais reutilizam estes dados; Editais já gerados mantêm a revisão que usaram.` });
    } catch (e) {
      if (isStale(e)) { keys.current = {}; setNotice({ kind: "stale", text: STALE_NOTICE }); }
      else setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível registrar o perfil.") });
    } finally {
      await utils.procurementProcess.licitacoesProfile.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      setBusy(false);
    }
  };

  const removeDefault = async (name: string) => {
    setShowErrors(true);
    if (!validateDecisionForm(decision).valid) { setReviewing(true); return; }
    setBusy(true);
    try {
      await recordProfile.mutateAsync({
        confirm: true, idempotencyKey: crypto.randomUUID(), expectedRevision: state.revision, catalogVersion: state.catalogVersion, defaults: withoutDefault(state.defaults, name),
        decision: { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() },
      } as never);
      setNotice({ kind: "ok", text: "Padrão institucional removido. Processos futuros voltam a pedir esta decisão." });
    } catch (e) { setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível remover o padrão.") }); }
    finally { await utils.procurementProcess.licitacoesProfile.invalidate(); setBusy(false); }
  };

  const defaultsSet = state.defaults.filter((d) => d.hasValue);
  return (
    <section id="perfil-licitacoes" aria-label="Perfil institucional de Licitações" className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Configuração única do órgão, reutilizada em todo Edital. {state.summary.pendingCount > 0
            ? <strong className="text-amber-700 dark:text-amber-300">{state.summary.pendingCount} {state.summary.pendingCount === 1 ? "campo pendente" : "campos pendentes"}</strong>
            : <strong className="text-emerald-700 dark:text-emerald-300">Perfil completo (revisão {state.revision})</strong>}
        </p>
        <p className="text-xs text-muted-foreground">Nada é inferido: o Prefeito não é presumido autoridade competente, e o último processo nunca é copiado. Cada papel é uma designação sua, com ato e vigência.</p>
      </header>

      {notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : notice.kind === "stale" ? "text-amber-700 dark:text-amber-300" : "text-destructive"}`}>{notice.text}</p>}

      <div className="space-y-3" aria-label="Papéis institucionais">
        <h3 className="text-sm font-semibold">Papéis institucionais</h3>
        {[...needed, ...others].map((r) => {
          const f = formOf(r.role, r.assignment);
          return (
            <fieldset key={r.role} className="space-y-2 rounded-lg border border-border p-3" data-role={r.role}>
              <legend className="px-1 text-sm font-medium">
                {r.label} <span className={`ml-1 text-xs font-normal ${r.state === "OK" ? "text-emerald-700 dark:text-emerald-300" : r.usedBy.length ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{r.usedBy.length || r.assignment ? STATE_LABEL[r.state] : "opcional"}</span>
              </legend>
              {r.reason && r.usedBy.length > 0 && r.state !== "OK" && <p className="text-xs text-amber-700 dark:text-amber-300">{r.reason}</p>}
              {r.usedBy.length > 0 && <p className="text-xs text-muted-foreground">Usado em: {r.usedBy.map((u) => u.description || u.name).join("; ")}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {([["name", "Nome", "text"], ["cargo", "Cargo / função", "text"], ["ato", "Ato / portaria / delegação", "text"], ["dataReferencia", "Data de referência do ato", "date"], ["vigenciaAte", "Vigência até (opcional)", "date"]] as const).map(([k, label, type]) => (
                  <label key={k} className="flex flex-col text-xs"><span className="mb-1 font-medium">{label}</span>
                    <input type={type} aria-label={`${r.label} — ${label}`} value={f[k]} className={INPUT} disabled={busy} onChange={(e) => setRole(r.role, r.assignment, { [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              {roleBuild.errors[r.role] && <p role="alert" className="text-xs text-destructive">{roleBuild.errors[r.role]}</p>}
              {r.assignment && !roleForms[r.role] && <button type="button" className="text-xs text-primary underline" onClick={() => setRole(r.role, r.assignment, emptyRoleForm())}>Substituir ocupante</button>}
            </fieldset>
          );
        })}
      </div>

      {state.sections.map((sec) => (
        <div key={sec.source} className="space-y-3" aria-label={SOURCE_TITLE[sec.source] ?? sec.source}>
          <h3 className="text-sm font-semibold">{SOURCE_TITLE[sec.source] ?? sec.source}</h3>
          {sec.fields.map((f) => (
            <PrepFieldControl key={f.path} field={f} value={edits[sec.source]?.[f.path] ?? toValue(f)} error={plan.errors[sec.source]?.[f.path]} disabled={busy} onChange={(v) => onEdit(sec.source, f, v)} />
          ))}
        </div>
      ))}

      <details className="rounded-lg border border-border" aria-label="Padrões institucionais">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Padrões institucionais — {defaultsSet.length}</summary>
        <div className="space-y-2 px-3 pb-3 text-sm">
          <p className="text-xs text-muted-foreground">Criados por você, a partir de um processo ("Usar como padrão institucional"). Valem para os próximos processos e podem ser alterados em cada um.</p>
          {defaultsSet.length === 0 && <p className="text-xs text-muted-foreground">Nenhum padrão definido.</p>}
          <ul className="space-y-1">
            {defaultsSet.map((d) => (
              <li key={d.name} className="flex flex-wrap items-center gap-2">
                <span>{d.description}: <strong>{formatDisplay(d.type, d.value)}</strong></span>
                {d.incompatibleReason && <em className="text-xs text-destructive">não aplicado: {d.incompatibleReason}</em>}
                <button type="button" disabled={busy} className="text-xs text-primary underline" onClick={() => removeDefault(d.name)}>Remover</button>
              </li>
            ))}
          </ul>
        </div>
      </details>

      {total > 0 && !reviewing && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!canSave} onClick={() => { setNotice(null); setReviewing(true); }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">Salvar perfil de Licitações</button>
          <span className="text-xs text-muted-foreground">{total} {total === 1 ? "alteração" : "alterações"} para registrar</span>
        </div>
      )}
      {reviewing && (
        <div className="space-y-3 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Revisar e registrar o perfil">
          {total > 0 && (
            <>
              <p className="text-sm font-semibold">{total} {total === 1 ? "alteração será registrada" : "alterações serão registradas"} (nova revisão do perfil):</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {plan.writes.flatMap((w) => w.lines.map((l) => <li key={`${w.id}-${l}`}>{l}</li>))}
                {roleBuild.changed.map((r) => <li key={r}>Papel {state.roles.find((x) => x.role === r)?.label ?? r}: {roleBuild.roles[r]?.name ?? "removido"}</li>)}
              </ul>
            </>
          )}
          <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, o REGISTRO do Perfil de Licitações (não é preenchimento automático)." />
          <div className="flex gap-2">
            <button type="button" disabled={busy || total === 0} onClick={save} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{busy ? "Registrando…" : "Confirmar e registrar"}</button>
            <button type="button" disabled={busy} onClick={() => setReviewing(false)} className="rounded-lg border border-input px-4 py-2 text-sm">Voltar</button>
          </div>
        </div>
      )}
    </section>
  );
}

const toValue = (f: PrepField): FormValue => toFormValue(f, f.hasValue ? f.currentValue : undefined);
