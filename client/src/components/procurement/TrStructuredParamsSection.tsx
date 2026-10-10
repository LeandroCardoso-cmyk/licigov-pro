import { useMemo, useState } from "react";
import { trpc } from "../../lib/trpc";
import PrepFieldControl from "./PrepFieldControl";
import UseAsDefaultButton from "./UseAsDefaultButton";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import {
  buildTrValues, trConfirmedFields, trFormValue, trOptionalFields, trParamToPrepField, trPendingFields, trProposals,
  type TrParamViewModel, type TrStructuredView,
} from "@/lib/contextReuse";
import { evaluateCond, formatDisplay, parseField, type FormValue } from "@/lib/editalPreparation";

export interface TrStructuredParamsSectionProps {
  processId: string;
  /** Chamado após confirmar parâmetros (o TR/Edital revalidam o que consomem). */
  onChanged?: () => void;
}

const ORIGIN_LABEL: Record<string, string> = { tr: "Confirmado no TR" };

function OriginLine({ f }: { f: TrParamViewModel }) {
  if (!f.origin) return null;
  const fromDefault = /;def:(\d+)$/.exec(f.origin.sourceVersion)?.[1];
  return (
    <p className="text-xs text-muted-foreground">
      {ORIGIN_LABEL[f.origin.sourceType] ?? f.origin.sourceType}
      {f.origin.actorUserId ? ` por usuário ${f.origin.actorUserId}` : ""}{f.origin.updatedAt ? ` em ${f.origin.updatedAt.slice(0, 10)}` : ""}
      {fromDefault ? ` · a partir do padrão institucional (revisão ${fromDefault}), confirmado por pessoa` : ""}
      {" "}· estado {f.origin.status}
    </p>
  );
}

/**
 * "Parâmetros estruturados da contratação" — camada estruturada do MESMO fluxo do TR. Orientada por exceção: só pede o que o sistema
 * ainda não sabe; padrões institucionais aparecem como PROPOSTA (nunca aplicados sem confirmação); o Edital consome os mesmos fatos.
 */
export default function TrStructuredParamsSection({ processId, onChanged }: TrStructuredParamsSectionProps) {
  const utils = trpc.useUtils();
  const query = trpc.procurementProcess.trStructuredParams.useQuery({ processId }, { enabled: !!processId });
  const record = trpc.procurementProcess.recordTrStructuredParams.useMutation();
  const [edits, setEdits] = useState<Record<string, FormValue>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmProposals, setConfirmProposals] = useState(false);
  const view = query.data as TrStructuredView | undefined;
  const fields = view?.status === "READY" ? view.fields : [];

  // Condicionais ativam AO VIVO conforme a pessoa digita (a autoridade final é o servidor).
  const live = useMemo(() => {
    const facts: Record<string, unknown> = {};
    for (const f of fields) if (f.status === "SET") facts[f.name] = f.value;
    for (const f of fields) {
      if (!Object.prototype.hasOwnProperty.call(edits, f.name)) continue;
      const r = parseField(trParamToPrepField(f), edits[f.name]);
      if (r.ok) { if (r.value === undefined) delete facts[f.name]; else facts[f.name] = r.value; }
    }
    return fields.map((f) => ({ ...f, active: !f.requiredWhen || evaluateCond(f.requiredWhen, facts) }));
  }, [fields, edits]);

  if (!view || view.status !== "READY") return null;
  const pending = trPendingFields(live);
  const optional = trOptionalFields(live);
  const confirmed = trConfirmedFields(live);
  const proposals = trProposals(live);
  const built = buildTrValues(live, edits);
  const changedCount = Object.keys(built.values).length;
  const open = pending.length > 0;

  const save = async (values: Record<string, unknown>, fromDefaults?: string[]) => {
    setNotice(null);
    try {
      const r = await record.mutateAsync({ processId, values, ...(fromDefaults?.length ? { fromDefaults } : {}) });
      setEdits({}); setEditing({}); setConfirmProposals(false);
      setNotice({ kind: "ok", text: r.recorded > 0 ? `${r.recorded} parâmetro(s) confirmado(s). O Edital reaproveita estes dados.` : "Nada mudou." });
      await utils.procurementProcess.trStructuredParams.invalidate({ processId });
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      await utils.procurementProcess.editalTemplatePreflight.invalidate();
      onChanged?.();
    } catch (e) {
      setNotice({ kind: "error", text: domainErrorMessage(e instanceof Error ? e.message : String(e), "Não foi possível confirmar os parâmetros.") });
    }
  };

  const onEdit = (f: TrParamViewModel, v: FormValue) => setEdits((p) => ({ ...p, [f.name]: v }));
  const control = (f: TrParamViewModel) => (
    <PrepFieldControl key={f.name} field={trParamToPrepField(f)} value={edits[f.name] ?? trFormValue(f)} error={built.errors[f.name]} disabled={record.isPending} onChange={(v) => onEdit(f, v)} />
  );

  return (
    <details open={open} className="mt-5 rounded-xl border border-border bg-card" aria-label="Parâmetros estruturados da contratação">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-foreground">
        Parâmetros estruturados da contratação
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {pending.length > 0 ? `${pending.length} pendente(s)` : "nenhuma pendência"} · {confirmed.length} confirmado(s)
        </span>
      </summary>
      <div className="space-y-4 px-5 pb-5">
        <p className="text-xs text-muted-foreground">
          Informe aqui, uma vez: o TR e o Edital usam exatamente estes dados (prazos, local de entrega, pagamento, garantias, qualificação, vigência…).
          O sistema não preenche nada por você — só propõe o que o órgão definiu como padrão institucional.
        </p>

        {notice && <p role={notice.kind === "ok" ? "status" : "alert"} className={`text-sm ${notice.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{notice.text}</p>}

        {proposals.length > 0 && (
          <div className="space-y-2 rounded-lg border border-primary/40 p-3" aria-label="Padrões institucionais disponíveis">
            <p className="text-sm font-medium">{proposals.length} parâmetro(s) com padrão institucional disponível</p>
            {!confirmProposals
              ? <button type="button" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" onClick={() => setConfirmProposals(true)}>Revisar e aplicar padrões</button>
              : (
                <div className="space-y-2">
                  <ul className="list-disc pl-5 text-sm">{proposals.map((f) => <li key={f.name}>{f.description}: <strong>{formatDisplay(f.type, f.proposal!.value)}</strong> <span className="text-xs text-muted-foreground">(padrão institucional, revisão {f.proposal!.orgProfileRevision})</span></li>)}</ul>
                  <div className="flex gap-2">
                    <button type="button" disabled={record.isPending} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:bg-muted"
                      onClick={() => save(Object.fromEntries(proposals.map((f) => [f.name, f.proposal!.value])), proposals.map((f) => f.name))}>Confirmo estes parâmetros</button>
                    <button type="button" className="rounded-lg border border-input px-3 py-1.5 text-xs" onClick={() => setConfirmProposals(false)}>Voltar</button>
                  </div>
                </div>
              )}
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-3" aria-label="Parâmetros pendentes">
            {pending.filter((f) => !f.proposal).map(control)}
            {pending.filter((f) => !!f.proposal).length > 0 && <p className="text-xs text-muted-foreground">Os parâmetros com padrão institucional acima também podem ser informados manualmente: digite o valor no campo abaixo.</p>}
            {pending.filter((f) => !!f.proposal).map(control)}
          </div>
        )}
        {pending.length === 0 && proposals.length === 0 && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Nenhum parâmetro pendente.</p>}

        {optional.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Decisões opcionais (ativam campos adicionais) — {optional.length}</summary>
            <div className="space-y-3 px-3 pb-3">{optional.map(control)}</div>
          </details>
        )}

        {confirmed.length > 0 && (
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Parâmetros confirmados — {confirmed.length}</summary>
            <ul className="space-y-2 px-3 pb-3 text-sm">
              {confirmed.map((f) => (
                <li key={f.name} className="space-y-1">
                  {editing[f.name]
                    ? control(f)
                    : (
                      <>
                        <p>{f.description}: <strong>{formatDisplay(f.type, f.value)}</strong>{" "}
                          <button type="button" className="text-xs text-primary underline" onClick={() => setEditing((p) => ({ ...p, [f.name]: true }))}>Alterar</button></p>
                        <OriginLine f={f} />
                        {f.defaultEligible && <UseAsDefaultButton name={f.name} description={f.description} type={f.type} value={f.value} processId={processId} />}
                      </>
                    )}
                </li>
              ))}
            </ul>
          </details>
        )}

        {changedCount > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={record.isPending || Object.keys(built.errors).length > 0} onClick={() => save(built.values)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
              {record.isPending ? "Confirmando…" : "Confirmar parâmetros"}
            </button>
            <span className="text-xs text-muted-foreground">{changedCount} parâmetro(s) para confirmar</span>
          </div>
        )}
      </div>
    </details>
  );
}
