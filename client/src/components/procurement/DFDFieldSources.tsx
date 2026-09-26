import { assistSummary, fieldIndicator, type DFDFieldViewUI, type FieldTone } from "./dfdFieldSources";

/**
 * Indicadores DISCRETOS de origem dos campos do DFD (Contexto Canônico). Fica abaixo do editor — não muda
 * o layout, as seções nem o fluxo do DFD. Ações são sempre explícitas ("Atualizar no rascunho") e, havendo
 * divergência ou ação, o valor atual no DFD, o valor de origem e a origem ficam visíveis ANTES do clique.
 */

const TONE_CLASS: Record<FieldTone, string> = {
  neutral: "text-muted-foreground",
  info: "text-primary",
  warning: "text-amber-700 dark:text-amber-300",
  muted: "text-muted-foreground/80 italic",
};

export type DFDFieldSourcesProps = {
  fields: readonly DFDFieldViewUI[];
  /** Há edição não salva no editor: ações de origem ficam bloqueadas (evita perder a edição). */
  dirty: boolean;
  busyKey: string | null;
  onAction: (key: string, confirm: boolean) => void;
};

export default function DFDFieldSources({ fields, dirty, busyKey, onAction }: DFDFieldSourcesProps) {
  if (fields.length === 0) return null;
  const s = assistSummary(fields);
  return (
    <details className="rounded-lg border border-border bg-card px-4 py-3 text-sm" open={s.attention > 0}>
      <summary className="cursor-pointer select-none font-medium text-foreground">
        Origem das informações
        <span className="ml-2 font-normal text-muted-foreground">
          {s.filled} preenchido(s) · {s.pending} a definir{s.attention > 0 ? ` · ${s.attention} para revisar` : ""}
        </span>
      </summary>
      {dirty && (
        <p className="mt-2 text-xs text-muted-foreground">Salve suas alterações para usar as ações de atualização.</p>
      )}
      <ul className="mt-2 divide-y divide-border">
        {fields.map((f) => {
          const ind = fieldIndicator(f);
          const detailsId = `dfd-field-${f.key.replace(/[^A-Za-z0-9_-]/g, "-")}-details`;
          return (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-field={f.key} data-state={f.state}>
              <span className="text-foreground">{ind.label}</span>
              <span className="flex items-center gap-2">
                <span className={`text-xs ${TONE_CLASS[ind.tone]}`}>{ind.text}</span>
                {ind.action && (
                  <button
                    type="button"
                    onClick={() => onAction(f.key, ind.confirmAction)}
                    disabled={dirty || busyKey !== null}
                    aria-label={ind.actionAriaLabel ?? undefined}
                    aria-describedby={ind.details ? detailsId : undefined}
                    className="rounded-md border border-input px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                  >
                    {busyKey === f.key ? "Atualizando..." : ind.action}
                  </button>
                )}
              </span>
              {ind.details && (
                <dl id={detailsId} className="grid w-full grid-cols-1 gap-x-3 gap-y-0.5 rounded-md bg-muted/50 px-2 py-1.5 text-xs sm:grid-cols-[max-content_1fr]" data-testid="dfd-field-details">
                  {ind.details.map((d) => (
                    <div key={d.label} className="contents">
                      <dt className="text-muted-foreground">{d.label}</dt>
                      <dd className="break-words text-foreground">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
