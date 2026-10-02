import React from "react";
import { trpc } from "../../lib/trpc";
import { buildSavePatch, hydrationKey, useHydratedForm } from "../../lib/formHydration";

/**
 * ContractJustificationWorkspace — REAL (tRPC).
 *
 * R5 / PR-11 (SEM-021) — a IA SUGERE, a pessoa DECIDE:
 *  - o formulário hidrata a justificativa já registrada (nunca abre em branco sobre um registro existente);
 *  - "Gerar sugestão com copilotos" só devolve uma SUGESTÃO (com reasoning/explainability/provenance/confiança);
 *    nada é gravado nem vira documento oficial;
 *  - a pessoa pode copiar a sugestão para o formulário, editar e então REGISTRAR com aceite explícito — só aí a
 *    justificativa é persistida e o documento oficial é gerado, com o autor humano;
 *  - campos centrais em branco nunca sobrescrevem o registro (o servidor também recusa).
 */

export interface ContractJustificationWorkspaceProps {
  workspaceId: string;
}

const FIELDS = [
  ["need", "Necessidade"], ["publicInterest", "Interesse público"], ["motivation", "Motivação"],
  ["legalFoundation", "Fundamento"], ["benefits", "Benefícios"], ["alternatives", "Alternativas"],
] as const;
type FieldKey = (typeof FIELDS)[number][0];
const EMPTY: Record<FieldKey, string> = { need: "", publicInterest: "", motivation: "", legalFoundation: "", benefits: "", alternatives: "" };

export default function ContractJustificationWorkspace({ workspaceId }: ContractJustificationWorkspaceProps) {
  const utils = trpc.useUtils();
  const persisted = trpc.directProcurement.getJustifications.useQuery({ workspaceId });
  const current = persisted.data?.contract ?? null;
  const form = useHydratedForm({ server: current, empty: EMPTY, key: hydrationKey(workspaceId, current?.id, current?.updatedAt), loading: persisted.isLoading });
  const [basedOnSuggestion, setBasedOnSuggestion] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);

  const generate = trpc.directProcurement.generateJustification.useMutation();
  const accept = trpc.directProcurement.acceptJustification.useMutation({
    onSuccess: () => { setConfirm(false); void utils.directProcurement.getJustifications.invalidate({ workspaceId }); },
  });
  const rec = generate.data?.recommendation;
  const suggestion = generate.data?.suggestion;
  const changed = Object.keys(buildSavePatch(current, form.values)).length > 0;
  const centralFilled = (["need", "motivation", "legalFoundation"] as const).every((k) => (form.values[k] ?? "").trim().length >= 10);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Justificativa da Contratação</h3>
        <button type="button" onClick={() => generate.mutate({ workspaceId })} disabled={generate.isPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
          {generate.isPending ? "Gerando…" : "Gerar sugestão com copilotos"}
        </button>
      </div>
      {generate.isError && <p className="text-xs text-red-600 dark:text-red-400">{generate.error.message}</p>}

      {rec && suggestion && (
        <div className="space-y-2 rounded-md border border-indigo-100 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-indigo-900 dark:text-indigo-200">Sugestão dos copilotos (não registrada)</span>
            <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800">confiança {Math.round(rec.confidence * 100)}%</span>
          </div>
          <p className="text-foreground"><strong>Reasoning:</strong> {rec.reasoning}</p>
          <p className="text-muted-foreground"><strong>Explainability:</strong> {rec.explainability}</p>
          <p className="text-muted-foreground"><strong>Provenance:</strong> {rec.provenance}</p>
          <button type="button" onClick={() => { for (const [k] of FIELDS) if (suggestion[k]) form.setField(k, suggestion[k]); setBasedOnSuggestion(true); }}
            className="rounded-md border border-indigo-300 dark:border-indigo-700 px-2 py-1 text-[11px] font-medium text-indigo-800 dark:text-indigo-200">
            Usar sugestão no formulário (para revisar)
          </button>
        </div>
      )}

      {FIELDS.map(([k, label]) => (
        <label key={k} className="block text-xs font-medium text-foreground">{label}
          <textarea value={form.values[k] ?? ""} onChange={(e) => form.setField(k, e.target.value)} rows={2}
            className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
      ))}
      <label className="flex items-start gap-2 text-xs text-foreground">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
        Revisei o conteúdo e confirmo que esta é a justificativa institucional (a sugestão da IA não é registrada sem este aceite).
      </label>
      {accept.isError && <p className="text-xs text-red-600 dark:text-red-400">{accept.error.message}</p>}
      {accept.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Justificativa registrada.</p>}
      <button type="button" disabled={!form.ready || !confirm || !centralFilled || !changed || accept.isPending}
        onClick={() => accept.mutate({ workspaceId, ...EMPTY, ...Object.fromEntries(FIELDS.map(([k]) => [k, form.values[k] ?? ""])), basedOnSuggestion, confirmAccept: true })}
        className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {!form.ready ? "Carregando…" : accept.isPending ? "Registrando…" : current ? "Registrar nova versão da justificativa" : "Registrar justificativa"}
      </button>
      {!centralFilled && <p className="text-[11px] text-muted-foreground">Necessidade, motivação e fundamento precisam de ao menos 10 caracteres.</p>}
    </div>
  );
}
