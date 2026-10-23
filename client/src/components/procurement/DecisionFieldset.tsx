import { validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";

const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

/** Texto do registro eletrônico padrão (o sistema já sabe quem é a pessoa, o órgão e o papel). */
export const ELECTRONIC_DECISION_LINE = "Registrado em seu nome (usuário autenticado), com data e hora do servidor.";
export const FORMAL_ACT_SUMMARY = "Informar ato formal (opcional)";

export interface DecisionFieldsetProps {
  decision: DecisionFormState;
  onDecision: (d: DecisionFormState) => void;
  showErrors: boolean;
  /** Texto do consentimento (o que a pessoa está confirmando). */
  consent: string;
  /** Legenda do grupo (padrão: "Registro da decisão"). */
  legend?: string;
}

/**
 * LICIGOV-FAST (M8-UX-GOV-001): registro da decisão com o usuário autenticado + confirmação explícita. Ninguém redigita nome, cargo e
 * data: o servidor registra eletronicamente. O ato formal (portaria/ata/processo) é OPCIONAL, atrás de um disclosure; se preenchido,
 * precisa estar completo (o servidor recusa ato parcial).
 */
export default function DecisionFieldset({ decision, onDecision, showErrors, consent, legend = "Registro da decisão" }: DecisionFieldsetProps) {
  const dErr = validateDecisionForm(decision).errors;
  const err = (k: keyof DecisionFormState) => showErrors && dErr[k] ? <span role="alert" className="text-destructive">{dErr[k]}</span> : null;
  return (
    <fieldset className="space-y-2 text-xs">
      <legend className="px-1 font-medium">{legend}</legend>
      <p className="text-muted-foreground">{ELECTRONIC_DECISION_LINE}</p>
      <details open={decision.formal === true} onToggle={(e) => {
        const open = (e.currentTarget as HTMLDetailsElement).open;
        if (open !== (decision.formal === true)) onDecision({ ...decision, formal: open });
      }} className="rounded-lg border border-border px-3 py-2">
        <summary className="cursor-pointer font-medium">{FORMAL_ACT_SUMMARY}</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">Só se houver ato formal (portaria, ata, processo). Se preencher, informe todos os campos; para não enviar, feche esta área.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {([["decidedByName", "Autoridade que decidiu (nome)", "text"], ["decidedByRole", "Cargo / função", "text"], ["decidedAt", "Data do ato", "date"], ["basisReference", "Referência do ato (portaria, ata, processo)", "text"]] as const).map(([k, label, type]) => (
              <label key={k} className="flex flex-col"><span className="mb-1 font-medium">{label}</span>
                <input type={type} value={decision[k]} className={INPUT} onChange={(e) => onDecision({ ...decision, [k]: e.target.value })} />
                {err(k)}
              </label>
            ))}
          </div>
          <label className="flex flex-col"><span className="mb-1 font-medium">Justificativa (mín. 10 caracteres)</span>
            <textarea rows={2} value={decision.reason} className={INPUT} onChange={(e) => onDecision({ ...decision, reason: e.target.value })} />
            {err("reason")}
          </label>
        </div>
      </details>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={decision.confirmed} onChange={(e) => onDecision({ ...decision, confirmed: e.target.checked })} />
        <span>{consent}</span></label>
      {err("confirmed")}
    </fieldset>
  );
}
