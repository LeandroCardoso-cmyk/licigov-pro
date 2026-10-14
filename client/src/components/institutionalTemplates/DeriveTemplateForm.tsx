import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionNote } from "./ActionNote";
import { effectiveDeriveSlug, validateDeriveForm, type DeriveFormState } from "@/lib/institutionalTemplatesView";

export interface DeriveTemplateFormProps {
  /** Descrição da origem (ex.: "Modelo da plataforma: Edital — Pregão Eletrônico — BLL"). */
  sourceLabel: string;
  value: DeriveFormState;
  onChange: (next: DeriveFormState) => void;
  showErrors?: boolean;
}

/**
 * Derivar = criar uma cópia ADAPTÁVEL no seu órgão, como rascunho, com versionamento independente e lineage preservado. Nunca altera o modelo de origem.
 * LICIGOV-FAST: só o NOME é obrigatório; o identificador é derivado dele (editável em "avançado"); nada de autoridade/cargo/ato.
 */
export function DeriveTemplateForm({ sourceLabel, value, onChange, showErrors = false }: DeriveTemplateFormProps) {
  const { errors } = validateDeriveForm(value);
  const err = (k: "slug" | "displayName" | "declaredAuthor") => (showErrors ? errors[k] : undefined);
  return (
    <form className="space-y-3" aria-label="Derivar modelo" onSubmit={(e) => e.preventDefault()}>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{sourceLabel}</p>
        <p className="mt-1 text-muted-foreground">Cria um modelo PRÓPRIO do seu órgão, como rascunho, copiado desta origem. A origem permanece intacta e o vínculo com ela (lineage) fica registrado. Não publica nem vincula nada.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="der-displayName">Nome do modelo</Label>
        <Input id="der-displayName" value={value.displayName} placeholder="ex.: Edital Pregão — Prefeitura" aria-invalid={err("displayName") ? true : undefined} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
        {err("displayName") && <p role="alert" className="text-xs text-destructive">{err("displayName")}</p>}
        <p className="text-xs text-muted-foreground" data-testid="derive-slug">Identificador: <span className="font-mono">{effectiveDeriveSlug(value) || "—"}</span></p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Opções avançadas</summary>
        <div className="mt-2 space-y-3">
          {([["slug", "Identificador (slug) — deixe em branco para usar o do nome", "ex.: edital-pregao-municipal"], ["declaredAuthor", "Autor/setor", "ex.: Setor de Licitações"]] as const).map(([k, label, ph]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`der-${k}`}>{label}</Label>
              <Input id={`der-${k}`} value={value[k]} placeholder={ph} aria-invalid={err(k) ? true : undefined} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
              {err(k) && <p role="alert" className="text-xs text-destructive">{err(k)}</p>}
            </div>
          ))}
        </div>
      </details>
      <ActionNote id="der-note" note={value.note} onNote={(n) => onChange({ ...value, note: n })} consequence="O novo rascunho nasce no seu órgão; você poderá adaptá-lo e depois disponibilizá-lo para elaboração." />
    </form>
  );
}
