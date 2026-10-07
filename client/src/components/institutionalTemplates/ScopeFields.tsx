import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SCOPE_DIMENSION_COPY, SCOPE_DIMENSION_ORDER, scopeFormProblems, type ScopeFormState } from "@/lib/institutionalTemplatesView";

export interface ScopeFieldsProps {
  idPrefix: string;
  documentKind: string;
  value: ScopeFormState;
  onChange: (next: ScopeFormState) => void;
  /** Vocabulário SUGERIDO por dimensão (token → rótulo). Não é lista fechada: serve de apoio, nunca de seleção automática. */
  suggestions?: Partial<Record<(typeof SCOPE_DIMENSION_ORDER)[number], Record<string, string>>>;
  /** Dimensões que a persistência atual grava; as demais são sinalizadas (a API recusa em vez de descartar em silêncio). */
  persistedDimensions?: readonly string[];
  showErrors?: boolean;
}

/**
 * Aplicabilidade EXPLÍCITA: modalidade, forma, plataforma, regime e critério declarados pela pessoa. Nada é preenchido por
 * inferência e nenhum modelo é escolhido em silêncio — o que ficar em branco é "não declarado" (só casa com pedido que também não declara).
 */
export function ScopeFields({ idPrefix, documentKind, value, onChange, suggestions, persistedDimensions, showErrors = false }: ScopeFieldsProps) {
  const problems = scopeFormProblems(documentKind, value);
  return (
    <fieldset className="space-y-2" aria-label="Aplicabilidade explícita">
      <legend className="text-sm font-medium">Aplicabilidade (declare cada dimensão)</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SCOPE_DIMENSION_ORDER.map((k) => {
          const listId = `${idPrefix}-${k}-list`;
          const unsupported = persistedDimensions !== undefined && !persistedDimensions.includes(k);
          const err = showErrors ? problems[k] : undefined;
          return (
            <div key={k} className="space-y-1">
              <Label htmlFor={`${idPrefix}-${k}`}>{SCOPE_DIMENSION_COPY[k]}</Label>
              <Input id={`${idPrefix}-${k}`} list={listId} value={value[k]} aria-invalid={err ? true : undefined} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
              <datalist id={listId}>{Object.entries(suggestions?.[k] ?? {}).map(([token, label]) => <option key={token} value={token}>{label}</option>)}</datalist>
              {unsupported && <p className="text-xs text-amber-700 dark:text-amber-300">Esta dimensão ainda não é gravada pela persistência atual: um vínculo que a use será recusado (fail-closed).</p>}
              {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
