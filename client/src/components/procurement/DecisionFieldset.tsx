import { validateDecisionForm, type DecisionFormState } from "@/lib/institutionalTemplatesView";

const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm";

export interface DecisionFieldsetProps {
  decision: DecisionFormState;
  onDecision: (d: DecisionFormState) => void;
  showErrors: boolean;
  /** Texto do consentimento (o que a pessoa está confirmando). */
  consent: string;
}

/** Autoridade humana DECLARADA no ato + confirmação explícita (mesmo formulário das demais decisões institucionais). */
export default function DecisionFieldset({ decision, onDecision, showErrors, consent }: DecisionFieldsetProps) {
  const dErr = validateDecisionForm(decision).errors;
  return (
    <fieldset className="space-y-2 text-xs">
      <legend className="px-1 font-medium">Autoridade humana</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {([["decidedByName", "Autoridade que decidiu (nome)", "text"], ["decidedByRole", "Cargo / função", "text"], ["decidedAt", "Data do ato", "date"], ["basisReference", "Referência do ato (portaria, ata, processo)", "text"]] as const).map(([k, label, type]) => (
          <label key={k} className="flex flex-col"><span className="mb-1 font-medium">{label}</span>
            <input type={type} value={decision[k]} className={INPUT} onChange={(e) => onDecision({ ...decision, [k]: e.target.value })} />
            {showErrors && dErr[k] && <span role="alert" className="text-destructive">{dErr[k]}</span>}
          </label>
        ))}
      </div>
      <label className="flex flex-col"><span className="mb-1 font-medium">Justificativa (mín. 10 caracteres)</span>
        <textarea rows={2} value={decision.reason} className={INPUT} onChange={(e) => onDecision({ ...decision, reason: e.target.value })} />
        {showErrors && dErr.reason && <span role="alert" className="text-destructive">{dErr.reason}</span>}
      </label>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={decision.confirmed} onChange={(e) => onDecision({ ...decision, confirmed: e.target.checked })} />
        <span>{consent}</span></label>
      {showErrors && dErr.confirmed && <p role="alert" className="text-destructive">{dErr.confirmed}</p>}
    </fieldset>
  );
}
