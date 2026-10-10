import { useState } from "react";
import { trpc } from "../../lib/trpc";
import DecisionFieldset from "./DecisionFieldset";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { defaultConsentText, withDefault, type DefaultViewModel } from "@/lib/contextReuse";
import { formatDisplay } from "@/lib/editalPreparation";
import { emptyDecisionForm, validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";

export interface UseAsDefaultButtonProps {
  /** Variável do catálogo (elegível pela Authority Matrix; o servidor recusa as demais). */
  name: string;
  description: string;
  type: string;
  /** Valor canônico DECIDIDO neste processo. */
  value: unknown;
  /** Processo atual (resolve o catálogo do modelo). */
  processId?: string;
  onDone?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * "Usar como padrão institucional nos próximos processos" — ação EXPLÍCITA e confirmada, só para campos elegíveis. Mostra a política
 * que será criada/atualizada ANTES de confirmar; nada é copiado automaticamente de processo anterior.
 */
export default function UseAsDefaultButton({ name, description, type, value, processId, onDone }: UseAsDefaultButtonProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<DecisionFormState>(() => emptyDecisionForm(today()));
  const [showErrors, setShowErrors] = useState(false);
  const [key, setKey] = useState<string>(() => crypto.randomUUID());
  const profile = trpc.procurementProcess.licitacoesProfile.useQuery({ processId } as never, { enabled: open });
  const record = trpc.institutionalTemplates.governed.recordLicitacoesProfile.useMutation();
  const state = profile.data?.status === "READY" ? profile.data : null;
  const existing = !!state?.defaults.find((d: DefaultViewModel) => d.name === name && d.hasValue);

  const confirm = async () => {
    setShowErrors(true);
    if (!state || !validateDecisionForm(decision).valid) return;
    await record.mutateAsync({
      confirm: true, idempotencyKey: key, expectedRevision: state.revision, catalogVersion: state.catalogVersion,
      defaults: withDefault(state.defaults as DefaultViewModel[], name, value),
      decision: { decidedByName: decision.decidedByName.trim(), decidedByRole: decision.decidedByRole.trim(), decidedAt: decision.decidedAt, basisReference: decision.basisReference.trim(), reason: decision.reason.trim() },
    } as never).then(async () => {
      setOpen(false); setKey(crypto.randomUUID()); setDecision((d) => ({ ...d, confirmed: false }));
      await utils.procurementProcess.licitacoesProfile.invalidate();
      await utils.procurementProcess.editalTemplatePreparation.invalidate();
      onDone?.();
    }).catch(() => undefined);
  };

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-primary underline">Usar como padrão institucional nos próximos processos</button>;
  }
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 p-3" role="dialog" aria-label="Usar como padrão institucional">
      <p className="text-sm">{defaultConsentText(description, formatDisplay(type, value), existing)}</p>
      {profile.isLoading && <p className="text-xs text-muted-foreground">Carregando o Perfil de Licitações…</p>}
      {profile.data && !state && <p role="alert" className="text-xs text-destructive">Perfil de Licitações indisponível para este órgão.</p>}
      {state && <DecisionFieldset decision={decision} onDecision={setDecision} showErrors={showErrors} consent="Confirmo, como pessoa responsável, a criação deste padrão institucional (não é preenchimento automático)." />}
      {record.isError && <p role="alert" className="text-xs text-destructive">{domainErrorMessage(record.error?.message, "Não foi possível registrar o padrão.")}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!state || record.isPending} onClick={confirm} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{record.isPending ? "Registrando…" : "Confirmar padrão"}</button>
        <button type="button" disabled={record.isPending} onClick={() => setOpen(false)} className="rounded-lg border border-input px-3 py-1.5 text-xs">Cancelar</button>
      </div>
    </div>
  );
}
