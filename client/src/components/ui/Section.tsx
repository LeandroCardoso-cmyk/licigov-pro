import React from "react";

/**
 * Section — agrupador institucional de NÍVEL 1 (V1 Visual Refinement, passagem 2).
 *
 * Reduz o efeito "caixas dentro de caixas": em vez de mais um Card com borda ao
 * redor de vários cards, o agrupamento vem de um CABEÇALHO de seção + espaçamento,
 * dando hierarquia sem adicionar outra superfície pesada. Os cards operacionais
 * (Nível 2) continuam existindo dentro da seção.
 */
export interface SectionProps {
  title: string;
  description?: string;
  /** Ação à direita do título da seção (opcional). */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Section({ title, description, action, children, className = "" }: SectionProps) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-end justify-between gap-3 border-b border-border/70 pb-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}
