import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_COPY, validateDecisionForm, type DecisionField, type DecisionFormState, type LifecycleAction } from "@/lib/institutionalTemplatesView";

export interface DecisionFormProps {
  action: LifecycleAction;
  revisionLabel: string;
  value: DecisionFormState;
  onChange: (next: DecisionFormState) => void;
  /** Mostra os erros (após a primeira tentativa de confirmar). */
  showErrors?: boolean;
}

const FIELDS: Array<{ key: Exclude<DecisionField, "confirmed" | "reason">; label: string; placeholder: string; type?: string }> = [
  { key: "decidedByName", label: "Autoridade que decidiu (nome)", placeholder: "Nome completo" },
  { key: "decidedByRole", label: "Cargo / função da autoridade", placeholder: "Ex.: Procurador-Geral" },
  { key: "decidedAt", label: "Data do ato", placeholder: "AAAA-MM-DD", type: "date" },
  { key: "basisReference", label: "Referência do ato", placeholder: "Portaria, ata ou processo administrativo" },
];

/**
 * Formulário da decisão institucional. A autoridade é a DECLARADA no ato (não é inferida de quem clica) e a ação só é
 * habilitada com confirmação humana explícita — sem caixa pré-marcada e sem texto que induza a confirmar.
 */
export function DecisionForm({ action, revisionLabel, value, onChange, showErrors = false }: DecisionFormProps) {
  const copy = ACTION_COPY[action];
  const { errors } = validateDecisionForm(value);
  const err = (k: DecisionField) => (showErrors ? errors[k] : undefined);
  return (
    <form className="space-y-3" aria-label={copy.title} onSubmit={(e) => e.preventDefault()}>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{revisionLabel}</p>
        <p className="mt-1 text-muted-foreground">{copy.consequence}</p>
      </div>
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`dec-${f.key}`}>{f.label}</Label>
          <Input id={`dec-${f.key}`} type={f.type ?? "text"} value={value[f.key]} placeholder={f.placeholder}
            aria-invalid={err(f.key) ? true : undefined} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
          {err(f.key) && <p role="alert" className="text-xs text-destructive">{err(f.key)}</p>}
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor="dec-reason">Justificativa</Label>
        <Textarea id="dec-reason" rows={3} value={value.reason} placeholder="Por que esta decisão está sendo tomada (mín. 10 caracteres)"
          aria-invalid={err("reason") ? true : undefined} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
        {err("reason") && <p role="alert" className="text-xs text-destructive">{err("reason")}</p>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} />
        <span>{copy.confirmLabel}</span>
      </label>
      {err("confirmed") && <p role="alert" className="text-xs text-destructive">{err("confirmed")}</p>}
    </form>
  );
}
