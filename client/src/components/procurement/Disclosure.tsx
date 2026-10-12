import type { ReactNode } from "react";

export interface DisclosureProps {
  /** Id estável do conteúdo (alvo de `aria-controls`). */
  id: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  title: ReactNode;
  /** Linha de apoio sob o título (ex.: por que está recolhido). */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Seção recolhível ACESSÍVEL (progressive disclosure): o gatilho é um `<button>` nativo (teclado: Enter/Espaço; foco preservado ao alternar),
 * com `aria-expanded` + `aria-controls`. O conteúdo recolhido fica em `hidden` (fora da árvore de acessibilidade, mas NUNCA removido do
 * DOM — o estado e o que a pessoa digitou persistem). Erros críticos e bloqueios principais NÃO ficam aqui dentro: ficam fora, sempre visíveis.
 */
export default function Disclosure({ id, open, onToggle, title, hint, children }: DisclosureProps) {
  return (
    <div className="rounded-lg border border-border" data-disclosure={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span>{title}</span>
        <span aria-hidden="true" className="text-xs text-muted-foreground">{open ? "Recolher ▲" : "Ver ▼"}</span>
      </button>
      {hint && !open && <p className="px-3 pb-3 text-xs text-muted-foreground">{hint}</p>}
      <div id={id} role="region" aria-label={typeof title === "string" ? title : undefined} hidden={!open} className="space-y-3 px-3 pb-3">
        {children}
      </div>
    </div>
  );
}
