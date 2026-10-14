import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DecisionForm } from "./DecisionForm";
import { validateDeriveForm, type DeriveFormState } from "@/lib/institutionalTemplatesView";

export interface DeriveTemplateFormProps {
  /** Descrição da origem (ex.: "Modelo da plataforma: Edital — Pregão Eletrônico — BLL"). */
  sourceLabel: string;
  value: DeriveFormState;
  onChange: (next: DeriveFormState) => void;
  showErrors?: boolean;
}

/** Derivar = criar uma cópia ADAPTÁVEL no seu órgão, como rascunho, com versionamento independente e lineage preservado. Nunca altera o modelo de origem. */
export function DeriveTemplateForm({ sourceLabel, value, onChange, showErrors = false }: DeriveTemplateFormProps) {
  const { errors } = validateDeriveForm(value);
  const err = (k: "slug" | "displayName" | "declaredAuthor") => (showErrors ? errors[k] : undefined);
  return (
    <form className="space-y-3" aria-label="Derivar modelo" onSubmit={(e) => e.preventDefault()}>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{sourceLabel}</p>
        <p className="mt-1 text-muted-foreground">Cria um modelo PRÓPRIO do seu órgão, como rascunho, copiado desta origem. A origem permanece intacta e o vínculo com ela (lineage) fica registrado. Não publica nem vincula nada.</p>
      </div>
      {([["slug", "Identificador (slug)", "ex.: edital-pregao-municipal"], ["displayName", "Nome do modelo", "ex.: Edital Pregão — Prefeitura"], ["declaredAuthor", "Autor/setor (opcional)", "ex.: Setor de Licitações"]] as const).map(([k, label, ph]) => (
        <div key={k} className="space-y-1">
          <Label htmlFor={`der-${k}`}>{label}</Label>
          <Input id={`der-${k}`} value={value[k]} placeholder={ph} aria-invalid={err(k) ? true : undefined} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
          {err(k) && <p role="alert" className="text-xs text-destructive">{err(k)}</p>}
        </div>
      ))}
      <DecisionForm action="APPROVE" revisionLabel="Registro da derivação (autoridade declarada)" value={value.decision} showErrors={showErrors} onChange={(d) => onChange({ ...value, decision: d })} />
    </form>
  );
}
